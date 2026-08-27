// HTTP-replay login for my.firstinspires.org (Azure AD / Entra ID OIDC).
//
// The FIRST dashboard delegates auth to an Azure AD tenant fronted by the
// custom domain firstcommunity.firstinspires.org. Hitting the dashboard
// unauthenticated 302s to the standard Microsoft-hosted login page
// (response_mode=form_post, response_type="code id_token"). There is no public
// API, so we replay the browser's login sequence with plain fetch:
//
//   1. GET /Dashboard/ -> follow 302s to the AAD authorize page (200 HTML).
//   2. Scrape the `$Config` JS blob for ctx (sCtx), flowToken (sFT), canary,
//      and urlPost (/<tenant>/login).
//   3. POST /<tenant>/GetCredentialType to refresh the flowToken / confirm the
//      account is a managed (non-federated) account.
//   4. POST urlPost with login + passwd + ctx + flowToken + canary.
//   5. Walk any interstitial pages (e.g. "Stay signed in?" / KMSI) by
//      re-POSTing to each page's urlPost, until AAD emits the form_post page:
//      a hidden auto-submit <form action="https://my.firstinspires.org/..."">
//      carrying code / id_token / state.
//   6. POST those hidden fields back to my.firstinspires.org -> session cookie.
//
// Nothing here logs credentials or cookie values — failures throw with the
// step name and HTTP status only. Set FIRST_DEBUG=1 for step-level tracing
// (statuses and field *presence* only, never values).

export type CookieJar = Record<string, Record<string, string>>; // host -> cookie name -> value

// A full desktop-Chrome UA makes Azure AD serve a JS "Redirecting" interstitial
// instead of the login form; the minimal UA below gets the login page directly.
const UA = "Mozilla/5.0";

const DEBUG = process.env.FIRST_DEBUG === "1";
function dbg(...args: unknown[]): void {
  if (DEBUG) console.error("[first-auth]", ...args);
}

export function cookieHeader(jar: CookieJar, host: string): string {
  const cookies = jar[host];
  if (!cookies) return "";
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function storeSetCookies(
  jar: CookieJar,
  host: string,
  setCookies: string[],
): void {
  const bag = (jar[host] ??= {});
  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0];
    const eq = first.indexOf("=");
    if (eq < 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    // A Set-Cookie with an empty/expired value clears the cookie.
    if (value === "" || /(^|;)\s*max-age=0\b/i.test(raw)) {
      delete bag[name];
    } else {
      bag[name] = value;
    }
  }
}

function hostOf(url: string): string {
  return new URL(url).host;
}

/** One request with manual redirect handling; stores any Set-Cookies into the jar. */
async function step(
  jar: CookieJar,
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const host = hostOf(url);
  const headers = new Headers(init.headers);
  headers.set("User-Agent", UA);
  const cookie = cookieHeader(jar, host);
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetchFn(url, { ...init, headers, redirect: "manual" });
  storeSetCookies(jar, host, res.headers.getSetCookie());
  dbg(init.method ?? "GET", new URL(url).pathname, "->", res.status);
  return res;
}

/** Follow 3xx redirects (GET) manually, collecting cookies, up to `max` hops. */
async function follow(
  jar: CookieJar,
  fetchFn: typeof fetch,
  startUrl: string,
  max = 15,
): Promise<Response> {
  let url = startUrl;
  for (let i = 0; i < max; i++) {
    const res = await step(jar, fetchFn, url, { method: "GET" });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    url = new URL(loc, url).toString();
  }
  throw new Error(`first-auth: too many redirects following ${startUrl}`);
}

/** Extract hidden <input> name/value pairs and the <form action> from HTML. Null if no form. */
function parseAutoPostForm(
  html: string,
): { action: string; fields: Record<string, string> } | null {
  const formMatch = html.match(/<form\b[^>]*>/i);
  const actionMatch = formMatch?.[0].match(/action="([^"]+)"/i);
  if (!actionMatch) return null;
  const action = decodeHtml(actionMatch[1]);
  const fields: Record<string, string> = {};
  const inputRe = /<input\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    const name = tag.match(/name="([^"]*)"/i)?.[1];
    const value = tag.match(/value="([^"]*)"/i)?.[1] ?? "";
    if (name) fields[name] = decodeHtml(value);
  }
  return { action, fields };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2b;/gi, "+")
    .replace(/&#43;/g, "+")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#x3d;/gi, "=")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

type AadConfig = {
  urlPost?: string;
  ctx?: string;
  flowToken?: string;
  canary?: string;
};

/** Pull the fields we need out of the Azure AD `$Config` JS blob (no full JSON parse).
 * These values are URL-safe base64/paths with no embedded quotes, so `[^"]*` is safe. */
function parseAadConfig(html: string): AadConfig {
  const str = (key: string): string | undefined =>
    html.match(new RegExp(`"${key}":"([^"]*)"`))?.[1];
  const raw = (v?: string) =>
    v === undefined ? undefined : v.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  return {
    urlPost: raw(str("urlPost")),
    ctx: str("sCtx"),
    flowToken: str("sFT"),
    canary: str("canary"),
  };
}

/** Full Azure AD login. Throws with a descriptive message on any step failure. */
export async function loginToFirst(
  username: string,
  password: string,
  fetchFn: typeof fetch = fetch,
): Promise<CookieJar> {
  const jar: CookieJar = {};

  // Step 1: hit the dashboard, follow 302s to the AAD login page.
  const loginPage = await follow(
    jar,
    fetchFn,
    "https://my.firstinspires.org/Dashboard/",
  );
  if (loginPage.status !== 200) {
    throw new Error(`first-auth: login page returned ${loginPage.status}`);
  }
  const loginUrl = loginPage.url;
  const idpHost = hostOf(loginUrl); // firstcommunity.firstinspires.org
  const idpOrigin = new URL(loginUrl).origin;
  if (!idpHost.includes("firstcommunity.firstinspires.org")) {
    throw new Error(`first-auth: expected AAD login page, landed on ${idpHost}`);
  }
  const html0 = await loginPage.text();
  const cfg0 = parseAadConfig(html0);
  if (!cfg0.urlPost || !cfg0.ctx || !cfg0.flowToken) {
    throw new Error("first-auth: login page missing urlPost/ctx/flowToken ($Config)");
  }
  const abs = (u: string) => new URL(u, idpOrigin).toString();

  // Step 2: GetCredentialType — refreshes the flowToken and rejects federated accounts.
  let flowToken = cfg0.flowToken;
  const gctRes = await step(jar, fetchFn, abs(`/common/GetCredentialType?mkt=en-US`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json",
      "canary": cfg0.canary ?? "",
      Referer: loginUrl,
      Origin: idpOrigin,
    },
    body: JSON.stringify({
      username,
      isOtherIdpSupported: true,
      checkPhones: false,
      isRemoteNGCSupported: true,
      isCookieBannerShown: false,
      isFidoSupported: true,
      country: "US",
      flowToken,
    }),
  });
  if (gctRes.status === 200) {
    try {
      const gct = (await gctRes.json()) as {
        FlowToken?: string;
        Credentials?: { FederationRedirectUrl?: string };
      };
      if (gct.Credentials?.FederationRedirectUrl) {
        throw new Error("first-auth: account is federated (SSO not supported by replay)");
      }
      if (gct.FlowToken) flowToken = gct.FlowToken;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("first-auth:")) throw e;
      // Non-JSON GCT response is non-fatal; fall back to the page flowToken.
    }
  }

  // Step 3: POST credentials to the tenant /login endpoint.
  const loginBody = new URLSearchParams({
    login: username,
    loginfmt: username,
    passwd: password,
    ctx: cfg0.ctx,
    flowToken,
    canary: cfg0.canary ?? "",
    LoginOptions: "3",
    type: "11",
    NewUser: "1",
    i13: "0",
    ps: "2",
    fspost: "0",
  });
  let resp = await step(jar, fetchFn, abs(cfg0.urlPost), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: loginUrl,
      Origin: idpOrigin,
    },
    body: loginBody.toString(),
  });

  // Step 4: walk interstitials (KMSI "stay signed in?", etc.) until the
  // form_post page appears (a hidden form whose action is my.firstinspires.org).
  let finalForm: { action: string; fields: Record<string, string> } | null = null;
  for (let i = 0; i < 5; i++) {
    if (resp.status >= 300 && resp.status < 400) {
      // Some steps 302 within the IdP; follow to the real content.
      const loc = resp.headers.get("location");
      resp = await follow(jar, fetchFn, abs(loc ?? cfg0.urlPost));
    }
    const html = await resp.text();
    const form = parseAutoPostForm(html);
    if (form && hostOf(form.action) === "my.firstinspires.org") {
      finalForm = form;
      break;
    }
    const cfg = parseAadConfig(html);
    if (!cfg.urlPost || !cfg.ctx || !cfg.flowToken) {
      throw new Error(
        "first-auth: unexpected IdP page after login (MFA/consent required?)",
      );
    }
    // Bouncing back to the credential-collection endpoint means AAD rejected
    // the submitted username/password (wrong creds, expired password, etc.).
    if (i > 0 && /\/login$/i.test(new URL(abs(cfg.urlPost)).pathname)) {
      throw new Error("first-auth: credentials rejected by AAD (back on /login)");
    }
    // Interstitial — re-POST (e.g. KMSI: LoginOptions=1 keeps the session).
    resp = await step(jar, fetchFn, abs(cfg.urlPost), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: resp.url || loginUrl,
        Origin: idpOrigin,
      },
      body: new URLSearchParams({
        LoginOptions: "1",
        ctx: cfg.ctx,
        flowToken: cfg.flowToken,
        canary: cfg.canary ?? "",
      }).toString(),
    });
  }
  if (!finalForm) {
    throw new Error("first-auth: never reached the form_post page (MFA/consent?)");
  }

  // Step 5: POST the code/id_token/state back to my.firstinspires.org.
  const tokenPost = await step(jar, fetchFn, finalForm.action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: idpOrigin + "/",
      Origin: idpOrigin,
    },
    body: new URLSearchParams(finalForm.fields).toString(),
  });
  // Follow any final same-host redirects to settle the session cookie.
  if (tokenPost.status >= 300 && tokenPost.status < 400) {
    const loc = tokenPost.headers.get("location");
    if (loc) await follow(jar, fetchFn, new URL(loc, finalForm.action).toString());
  } else if (tokenPost.status !== 200) {
    throw new Error(`first-auth: token POST returned ${tokenPost.status}`);
  }

  const session = jar["my.firstinspires.org"];
  if (!session || Object.keys(session).length === 0) {
    throw new Error("first-auth: no session cookie set after token POST");
  }
  return jar;
}

/**
 * GET a my.firstinspires.org URL with the jar. Returns { kind: "ok", body } on 200,
 * { kind: "auth" } when redirected to firstcommunity.firstinspires.org (session expired).
 */
export async function fetchWithSession(
  url: string,
  jar: CookieJar,
  fetchFn: typeof fetch = fetch,
): Promise<{ kind: "ok"; body: string } | { kind: "auth" }> {
  const res = await step(jar, fetchFn, url, { method: "GET" });
  if (res.status === 200) {
    return { kind: "ok", body: await res.text() };
  }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    if (loc.includes("firstcommunity.firstinspires.org") || /\/Login\b/i.test(loc)) {
      return { kind: "auth" };
    }
  }
  throw new Error(`first-auth: fetchWithSession got ${res.status} for ${hostOf(url)}`);
}
