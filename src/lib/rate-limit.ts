/**
 * Fixed-window in-memory rate limiter.
 *
 * Deliberately simple: state lives in module memory, so on serverless each
 * instance enforces independently (best-effort). For a team-sized app that is
 * an acceptable brake on abuse of the public endpoints; revisit if it isn't.
 */
type Limiter = { check(key: string): boolean };

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): Limiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { windowStart: number; count: number }>();
  return {
    check(key: string): boolean {
      const t = now();
      const entry = hits.get(key);
      if (!entry || t - entry.windowStart >= opts.windowMs) {
        hits.set(key, { windowStart: t, count: 1 });
        return true;
      }
      entry.count += 1;
      return entry.count <= opts.limit;
    },
  };
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

// Shared instances for the public endpoints.
export const studentLoginLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
export const accountRequestLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
