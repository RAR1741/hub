import { describe, expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { GMAIL_SEND_SCOPE, gmailCredentialsFromEnv, sendMail, type GmailCredentials, type GmailDeps } from "./gmail";

// A throwaway RSA key so the token-exchange JWT can actually sign in the test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDS: GmailCredentials = {
  clientEmail: "svc@proj.iam.gserviceaccount.com",
  privateKey: PEM,
  sender: "hub@redalert1741.org",
};

function decodeAssertionClaims(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  const assertion = params.get("assertion")!;
  const [, claimsB64] = assertion.split(".");
  return JSON.parse(Buffer.from(claimsB64, "base64url").toString());
}

type CapturedRequest = { url: string; init?: RequestInit };

// Fake fetch: dispatches on URL (token endpoint vs Gmail send endpoint) against
// a queue of canned responses, and records every request it received.
function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    requests.push({ url: href, init });
    if (href.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const next = queue.shift();
    if (!next) throw new Error(`no fake response queued for ${href}`);
    return new Response(next.body !== undefined ? JSON.stringify(next.body) : undefined, {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, requests };
}

describe("gmailCredentialsFromEnv", () => {
  test("reads and restores the private key from env vars", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
      sender: process.env.HUB_MAIL_SENDER,
    };
    process.env.GOOGLE_SA_CLIENT_EMAIL = "svc@proj.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    process.env.HUB_MAIL_SENDER = "hub@redalert1741.org";
    try {
      expect(gmailCredentialsFromEnv()).toEqual({
        clientEmail: "svc@proj.iam.gserviceaccount.com",
        privateKey: "line1\nline2",
        sender: "hub@redalert1741.org",
      });
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
      process.env.HUB_MAIL_SENDER = prev.sender;
    }
  });

  test("returns null when any var is missing", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
      sender: process.env.HUB_MAIL_SENDER,
    };
    delete process.env.HUB_MAIL_SENDER;
    process.env.GOOGLE_SA_CLIENT_EMAIL = "svc@proj.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    try {
      expect(gmailCredentialsFromEnv()).toBeNull();
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
      process.env.HUB_MAIL_SENDER = prev.sender;
    }
  });
});

describe("sendMail", () => {
  test("builds a plain-text RFC 2822 message, base64url-encodes it, and posts to Gmail send", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { id: "abc" } }]);
    const deps: GmailDeps = { fetch: fetchFn, credentials: CREDS };

    await sendMail(deps, { to: "student@example.com", subject: "Your code", text: "Your code is 123456" });

    const sendReq = requests.find((r) => r.url.includes("gmail.googleapis.com"))!;
    expect(sendReq.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(sendReq.init?.method).toBe("POST");
    expect((sendReq.init?.headers as Record<string, string>)?.Authorization).toBe("Bearer fake-token");
    expect((sendReq.init?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");

    const { raw } = JSON.parse(sendReq.init!.body as string) as { raw: string };
    const message = Buffer.from(raw, "base64url").toString();
    expect(message).toContain("From: hub@redalert1741.org");
    expect(message).toContain("To: student@example.com");
    expect(message).toContain("Subject: Your code");
    expect(message).toContain("MIME-Version: 1.0");
    expect(message).toContain("Content-Type: text/plain; charset=utf-8");
    expect(message).toContain("\r\n\r\nYour code is 123456");
  });

  test("requests a token with the gmail.send scope, impersonating the sender", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: {} }]);
    const deps: GmailDeps = { fetch: fetchFn, credentials: CREDS, now: () => 1_700_000_000_000 };

    await sendMail(deps, { to: "student@example.com", subject: "Hi", text: "body" });

    const tokenReq = requests.find((r) => r.url.includes("oauth2.googleapis.com/token"))!;
    const claims = decodeAssertionClaims(tokenReq.init!.body as string);
    expect(claims.scope).toBe(GMAIL_SEND_SCOPE);
    expect(claims.sub).toBe(CREDS.sender);
  });

  test("throws with the status on a non-2xx response", async () => {
    const { fetchFn } = fakeFetch([{ status: 403, body: { error: "forbidden" } }]);
    const deps: GmailDeps = { fetch: fetchFn, credentials: CREDS };

    await expect(sendMail(deps, { to: "x@example.com", subject: "s", text: "t" })).rejects.toThrow("403");
  });

  test("builds a multipart text+HTML message when html is given", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { id: "abc" } }]);
    const deps: GmailDeps = { fetch: fetchFn, credentials: CREDS };
    const text = "Your code is 123456—enjoy";
    const html = "<p>Your code is 123456—enjoy</p>\n<p>bye</p>";

    await sendMail(deps, { to: "student@example.com", subject: "Your code", text, html });

    const sendReq = requests.find((r) => r.url.includes("gmail.googleapis.com"))!;
    const { raw } = JSON.parse(sendReq.init!.body as string) as { raw: string };
    const message = Buffer.from(raw, "base64url").toString();

    const boundaryMatch = message.match(/Content-Type: multipart\/alternative; boundary="([^"]+)"/);
    expect(boundaryMatch).not.toBeNull();
    const boundary = boundaryMatch![1];

    const textPartIndex = message.indexOf("Content-Type: text/plain; charset=utf-8");
    const htmlPartIndex = message.indexOf("Content-Type: text/html; charset=utf-8");
    expect(textPartIndex).toBeGreaterThan(-1);
    expect(htmlPartIndex).toBeGreaterThan(-1);
    expect(textPartIndex).toBeLessThan(htmlPartIndex);

    const parts = message.split(`--${boundary}`);
    const textPart = parts.find((p) => p.includes("text/plain"))!;
    const htmlPart = parts.find((p) => p.includes("text/html"))!;

    expect(textPart).toContain("Content-Transfer-Encoding: 8bit");
    expect(textPart).toContain("Your code is 123456—enjoy");
    expect(textPart).toContain("Your code is 123456—enjoy\r\n");

    expect(htmlPart).toContain("Content-Transfer-Encoding: base64");
    const htmlLines = htmlPart
      .split("\r\n")
      .filter((line) => line.length > 0 && !line.startsWith("Content-"));
    for (const line of htmlLines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
    const decodedHtml = Buffer.from(htmlLines.join(""), "base64").toString();
    expect(decodedHtml).toBe(html);

    expect(message.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  test("rejects CR/LF in the To and Subject headers", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: {} }]);
    const deps: GmailDeps = { fetch: fetchFn, credentials: CREDS };
    await expect(sendMail(deps, { to: "x@example.com\r\nBcc: evil@example.com", subject: "s", text: "t" })).rejects.toThrow(
      "invalid header value",
    );
    await expect(sendMail(deps, { to: "x@example.com", subject: "s\nX: y", text: "t" })).rejects.toThrow("invalid header value");
  });
});
