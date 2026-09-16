/**
 * The push tester must NEVER be reachable on a real deployment. VERCEL_ENV is
 * auto-injected by Vercel on every deploy (prod|preview|development) under the
 * reserved, unforgeable VERCEL_ prefix. Returns true when the tester must 404.
 */
export function pushTestBlocked(): boolean {
  if (process.env.VERCEL_ENV) return true; // any Vercel deploy: blocked
  return process.env.NODE_ENV === "production"; // local prod build / CI: blocked; `next dev`: allowed
}
