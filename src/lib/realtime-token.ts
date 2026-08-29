import { createHmac } from "node:crypto";

const ISSUER = "hub-realtime";
const TTL_SECONDS = 60 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Mints an HS256 JWT authorizing the private `hub:*` realtime channels. */
export function mintRealtimeToken(
  secret: string,
  now: () => number = Date.now,
): { token: string; expiresAt: number } {
  const iat = Math.floor(now() / 1000);
  const exp = iat + TTL_SECONDS;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ role: "authenticated", iss: ISSUER, iat, exp }));
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return { token: `${signingInput}.${signature}`, expiresAt: exp * 1000 };
}
