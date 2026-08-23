/**
 * The Onshape dev mock must NEVER be reachable on a real Vercel deployment.
 * `VERCEL_ENV` is auto-injected by Vercel on every build/runtime (production |
 * preview | development) and lives under the reserved VERCEL_ prefix, so it
 * cannot be forged by adding a custom env var — unlike `ALLOW_ONSHAPE_MOCK`.
 * Returns true when the mock must 404.
 */
export function onshapeMockBlocked(): boolean {
  // Any Vercel deployment (prod OR preview): always blocked.
  if (process.env.VERCEL_ENV) return true;
  // Local dev (`next dev`): always available.
  if (process.env.NODE_ENV !== "production") return false;
  // Non-Vercel production-mode `next start` (i.e. CI e2e): explicit opt-in only.
  return process.env.ALLOW_ONSHAPE_MOCK !== "1";
}
