import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleSaCreds = { clientEmail: string; privateKey: string };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Signed RS256 service-account assertion for the OAuth2 token exchange.
 * `subject` is set only when domain-wide-delegation impersonation is needed
 * (e.g. acting as a user for the Directory API); omit it for calendar-style
 * service-account-only access.
 */
export function buildServiceAccountJwt(
  creds: GoogleSaCreds,
  opts: { scope: string; subject?: string },
  now: () => number = Date.now,
): string {
  const iat = Math.floor(now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: opts.scope,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
      ...(opts.subject ? { sub: opts.subject } : {}),
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(creds.privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

/** Exchange a signed service-account JWT for an OAuth2 access token. */
export async function fetchGoogleAccessToken(
  fetchFn: typeof globalThis.fetch,
  creds: GoogleSaCreds,
  opts: { scope: string; subject?: string },
  now: () => number = Date.now,
): Promise<string> {
  const assertion = buildServiceAccountJwt(creds, opts, now);
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token exchange returned no access_token");
  return json.access_token;
}
