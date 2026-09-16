import { createHmac } from "node:crypto";

const ISSUER = "hub-realtime";
const TTL_SECONDS = 15 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Mints an HS256 JWT authorizing the private `hub:*` realtime channels.
 *
 * Security note: this is a real project JWT (role `authenticated`, signed with
 * SUPABASE_JWT_SECRET). Its power is bounded on purpose:
 *  - Realtime: the only policy on realtime.messages is SELECT, scoped to
 *    `topic like 'hub:%'` (see supabase/migrations/..._realtime_broadcast_authz.sql),
 *    so a holder can only RECEIVE our contentless refetch nudges — not send,
 *    not join other channels.
 *  - Data tables: every app table has RLS enabled with zero policies, so the
 *    `authenticated` role reads nothing (only `service_role` bypasses RLS).
 * Because of that, a leaked token is worth very little today. If a future
 * migration ever grants the `authenticated` role access to any table, revisit
 * this token (it is broadly issued to any non-guest viewer or kiosk device):
 * that grant would widen every one of these tokens. Kept short-lived and
 * carrying a `sub` for attribution to limit the blast radius regardless.
 *
 * `subject` identifies who the token was issued to (e.g. `person:<id>` or
 * `kiosk`), for log attribution — it is not used for authorization.
 */
export function mintRealtimeToken(
  secret: string,
  subject: string,
  now: () => number = Date.now,
): { token: string; expiresAt: number } {
  const iat = Math.floor(now() / 1000);
  const exp = iat + TTL_SECONDS;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ role: "authenticated", iss: ISSUER, sub: subject, iat, exp }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return { token: `${signingInput}.${signature}`, expiresAt: exp * 1000 };
}
