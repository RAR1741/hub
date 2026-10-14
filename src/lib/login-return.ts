/** Same-origin path to return to after sign-in, or "/" if `raw` is anything else. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return "/";
  const u = new URL(raw, "http://x"); // normalizes; strips tab/CR/LF
  if (u.origin !== "http://x") return "/"; // //evil, /\evil, schemes
  if (/^\/(login|api\/|auth\/)/.test(u.pathname)) return "/"; // loops / non-pages
  return u.pathname + u.search;
}

/** Login URL that returns to `next` afterwards. */
export function loginHref(next: string): string {
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
