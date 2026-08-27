// Manual-cookie session replay for my.firstinspires.org.
//
// Automated login was ruled infeasible (spike commit f73f8bb): the FIRST admin
// account is a bot-walled personal Microsoft account, so Azure AD login can't
// be replayed headlessly. Instead an admin pastes their browser's Cookie
// header for my.firstinspires.org into the app, and we replay it as-is on
// each roster fetch until it expires (detected via redirect to login).
//
// Never log or echo the cookie value.

/**
 * Normalize a pasted Cookie header: strip an optional leading "Cookie:" label,
 * trim, collapse internal newlines/whitespace to single spaces. PURE.
 */
export function normalizeCookieHeader(pasted: string): string {
  return pasted
    .trim()
    .replace(/^cookie:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Apply a batch of raw Set-Cookie header strings onto a flat Cookie request
 * header, rotating/adding/deleting names as instructed. PURE. Ported from the
 * per-host jar logic in spike commit f73f8bb (storeSetCookies/cookieHeader),
 * adapted to operate on a flat header string instead of a jar object.
 */
export function mergeSetCookies(header: string, setCookies: string[]): string {
  const names: string[] = [];
  const values = new Map<string, string>();
  for (const pair of header.split("; ")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq);
    names.push(name);
    values.set(name, pair.slice(eq + 1));
  }

  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0];
    const eq = first.indexOf("=");
    if (eq < 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    if (value === "" || /(^|;)\s*max-age=0\b/i.test(raw)) {
      values.delete(name);
      const idx = names.indexOf(name);
      if (idx >= 0) names.splice(idx, 1);
    } else {
      if (!values.has(name)) names.push(name);
      values.set(name, value);
    }
  }

  return names.map((name) => `${name}=${values.get(name)}`).join("; ");
}

/**
 * GET a my.firstinspires.org URL replaying `cookie` (a raw Cookie header).
 * 200 -> { kind: "ok", body, cookie } where `cookie` is the header merged
 * with any rotated Set-Cookie values (sliding-expiration sessions rotate the
 * cookie on each authenticated response; persist and replay this next). A 3xx
 * redirecting to the FIRST login IdP or /Login -> { kind: "auth" } (session
 * expired). Any other status throws.
 */
export async function fetchWithSession(
  url: string,
  cookie: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ kind: "ok"; body: string; cookie: string } | { kind: "auth" }> {
  const res = await fetchFn(url, {
    headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
    redirect: "manual",
  });
  if (res.status === 200) {
    return { kind: "ok", body: await res.text(), cookie: mergeSetCookies(cookie, res.headers.getSetCookie()) };
  }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    if (loc.includes("firstcommunity.firstinspires.org") || /\/Login\b/i.test(loc)) {
      return { kind: "auth" };
    }
  }
  throw new Error(`first-auth: roster fetch returned ${res.status}`);
}
