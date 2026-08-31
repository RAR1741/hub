// The styleguide is a dev/preview tool; it must never render in real prod.
// Gate on VERCEL_ENV (unforgeable) — NOT NODE_ENV, which is "production" under
// `next start` in CI e2e where we DO want the route reachable.
export function styleguideBlocked(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  return vercelEnv === "production" || vercelEnv === "preview";
}
