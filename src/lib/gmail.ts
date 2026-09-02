import { randomUUID } from "node:crypto";
import { fetchGoogleAccessToken } from "./google-auth";

export type GmailCredentials = { clientEmail: string; privateKey: string; sender: string };

export type GmailDeps = {
  fetch: typeof globalThis.fetch;
  credentials: GmailCredentials;
  now?: () => number;
};

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** Read Gmail-sending service-account creds from env; null if not fully configured. */
export function gmailCredentialsFromEnv(): GmailCredentials | null {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  // Private keys in env keep literal "\n"; restore real newlines for the PEM parser.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sender = process.env.HUB_MAIL_SENDER;
  if (!clientEmail || !privateKey || !sender) return null;
  return { clientEmail, privateKey, sender };
}

// Wrap a base64 string into 76-char lines per RFC 2045.
function wrapBase64(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}

function buildMessage(sender: string, to: string, subject: string, text: string, html?: string): string {
  // Header values must be single-line; a CR/LF in `to`/`subject` would inject headers.
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) throw new Error("invalid header value");
  if (html === undefined) {
    return [
      `From: ${sender}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      text,
    ].join("\r\n");
  }
  const boundary = randomUUID();
  return [
    `From: ${sender}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text.replace(/\r?\n/g, "\r\n"),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(html).toString("base64")),
    `--${boundary}--`,
  ].join("\r\n");
}

/** Send a plain-text (or multipart text+HTML) email via the Gmail API, impersonating the configured sender. */
export async function sendMail(
  deps: GmailDeps,
  message: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  const token = await fetchGoogleAccessToken(
    deps.fetch,
    deps.credentials,
    { scope: GMAIL_SEND_SCOPE, subject: deps.credentials.sender },
    deps.now,
  );
  const raw = Buffer.from(
    buildMessage(deps.credentials.sender, message.to, message.subject, message.text, message.html),
  ).toString("base64url");
  const res = await deps.fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`send mail failed: ${res.status}`);
}
