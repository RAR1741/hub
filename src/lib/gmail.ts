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

function buildMessage(sender: string, to: string, subject: string, text: string): string {
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

/** Send a plain-text email via the Gmail API, impersonating the configured sender. */
export async function sendMail(
  deps: GmailDeps,
  message: { to: string; subject: string; text: string },
): Promise<void> {
  const token = await fetchGoogleAccessToken(
    deps.fetch,
    deps.credentials,
    { scope: GMAIL_SEND_SCOPE, subject: deps.credentials.sender },
    deps.now,
  );
  const raw = Buffer.from(buildMessage(deps.credentials.sender, message.to, message.subject, message.text)).toString(
    "base64url",
  );
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
