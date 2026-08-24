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
});
