/** Same-origin path to return to after sign-in, or "/" if `raw` is anything else. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return "/";
  let u: URL;
  try {
    u = new URL(raw, "http://x"); // normalizes; strips tab/CR/LF
  } catch {
    return "/"; // e.g. "/\t/[" → "//[" parses as an invalid host and throws
  }
  if (u.origin !== "http://x") return "/"; // //evil, /\evil, schemes
  if (/^\/(login|api|auth)(\/|$)/.test(u.pathname)) return "/"; // loops / non-pages
  const out = u.pathname + u.search;
  // normalization (`/.//evil.com`) can yield a protocol-relative path
  if (out.startsWith("//") || out[1] === "\\") return "/";
  return out;
}

/** Login URL that returns to `next` afterwards. */
export function loginHref(next: string): string {
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
