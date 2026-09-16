/**
 * Boot-time backstop for FORGEABLE dev-bypass flags (a custom env var an
 * attacker could set, unlike the reserved VERCEL_* vars) — see the
 * unforgeable VERCEL_ENV check in `src/app/api/dev/onshape-mock/gate.ts`.
 * NODE_ENV/VERCEL_ENV-gated routes need no entry here.
 */

// ponytail: plain string[] with uniform `=== "1"` check; switch to a
// {name, enabled(env)} shape only when a flag needs different truthiness.
const DEV_BYPASS_FLAGS = ["ALLOW_ONSHAPE_MOCK"];

const LOCAL_SUPABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "host.docker.internal",
  "[::1]",
]);

export function assertDevBypassFlagsSafe(
  env: Record<string, string | undefined>,
): void {
  const enabledFlags = DEV_BYPASS_FLAGS.filter((name) => env[name] === "1");
  if (enabledFlags.length === 0) return;

  const dbUrl = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  let dbClause: string | null = null;
  if (dbUrl) {
    try {
      const hostname = new URL(dbUrl).hostname;
      if (!LOCAL_SUPABASE_HOSTS.has(hostname)) {
        dbClause = `Supabase URL points at non-local host "${hostname}"`;
      }
    } catch {
      // fail-closed: an unparseable URL is treated as non-local
      dbClause = `Supabase URL "${dbUrl}" could not be parsed`;
    }
  }

  const vercelEnv = env.VERCEL_ENV;
  const vercelClause =
    vercelEnv === "production" || vercelEnv === "preview"
      ? `VERCEL_ENV="${vercelEnv}"`
      : null;

  if (dbClause || vercelClause) {
    const clauses = [dbClause, vercelClause].filter(Boolean).join(" and ");
    throw new Error(
      `Dev-bypass flag(s) ${enabledFlags.map((f) => `${f}=1`).join(", ")} ` +
        `enabled while ${clauses}. Unset the flag, or point the Supabase ` +
        `URL at a local host (localhost/127.0.0.1/host.docker.internal/[::1]).`,
    );
  }
}
