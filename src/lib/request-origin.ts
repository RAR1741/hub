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
 */
export function clientUrl(request: Request, path: string): URL {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return new URL(path, request.url); // last-resort fallback
  const proto = h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(/:$/, "");
  return new URL(path, `${proto}://${host}`);
}
