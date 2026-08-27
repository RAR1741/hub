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
 * GET a my.firstinspires.org URL replaying `cookie` (a raw Cookie header).
 * 200 -> { kind: "ok", body }. A 3xx redirecting to the FIRST login IdP or
 * /Login -> { kind: "auth" } (session expired). Any other status throws.
 */
export async function fetchWithSession(
  url: string,
  cookie: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ kind: "ok"; body: string } | { kind: "auth" }> {
  const res = await fetchFn(url, {
    headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
    redirect: "manual",
  });
  if (res.status === 200) {
    return { kind: "ok", body: await res.text() };
  }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    if (loc.includes("firstcommunity.firstinspires.org") || /\/Login\b/i.test(loc)) {
      return { kind: "auth" };
    }
  }
  throw new Error(`first-auth: roster fetch returned ${res.status}`);
}
