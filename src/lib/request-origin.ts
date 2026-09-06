/**
 * Absolute URL for `path` on the origin the CLIENT actually used.
 *
 * We can't build redirects from `request.url`: under `next dev -H 0.0.0.0`
 * (required so the host browser can reach the dev server inside the container)
 * Next reports `request.url` with host `0.0.0.0`, which isn't browseable — a
 * redirect built from it sends the user to http://0.0.0.0:3000/. The client's
 * real host is the `Host` header in local dev, or `x-forwarded-host` behind a
 * proxy such as Vercel; the scheme is `x-forwarded-proto` there, otherwise the
 * scheme of `request.url` (http in dev, https in prod).
 *
 * Security (audit #251): that host comes from a client-controlled header, and
 * it feeds redirects and OAuth `redirect_uri`s. A proxy that doesn't overwrite
 * `x-forwarded-host` would let an attacker point those at their own host
 * (host-swap phishing / poisoned redirect_uri). Set `APP_ALLOWED_HOSTS` (a
 * comma-separated list of the canonical host[:port]s) in production and any
 * unrecognized host is pinned to the first allow-listed host instead of being
 * trusted. When `APP_ALLOWED_HOSTS` is unset (local dev, preview deploys where
 * hostnames are dynamic) the header is used as before — localhost and the
 * container hosts are always accepted.
 */
export function clientUrl(request: Request, path: string): URL {
  const h = request.headers;
  const candidate = h.get("x-forwarded-host") ?? h.get("host");
  const host = safeHost(candidate);
  if (!host) return new URL(path, request.url); // last-resort fallback
  const proto = h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(/:$/, "");
  return new URL(path, `${proto}://${host}`);
}

/** Comma-separated canonical host[:port]s from APP_ALLOWED_HOSTS, lowercased. */
function allowedHosts(): string[] {
  return (process.env.APP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Local/dev hosts that are always safe redirect targets, regardless of config. */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "host.docker.internal"
  );
}

/**
 * Returns the host to build the URL from:
 * - no allow-list configured → the candidate unchanged (preserves dev/preview behavior);
 * - candidate is allow-listed (or a local host) → the candidate;
 * - candidate is missing or not allow-listed → the canonical (first allow-listed) host.
 */
function safeHost(candidate: string | null): string | null {
  const allow = allowedHosts();
  if (allow.length === 0) return candidate;
  if (candidate) {
    const h = candidate.toLowerCase();
    const hostname = h.split(":")[0];
    if (isLocalHost(hostname) || allow.includes(h) || allow.includes(hostname)) {
      return candidate;
    }
  }
  return allow[0];
}
