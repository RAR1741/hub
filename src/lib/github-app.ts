import { createSign } from "node:crypto";

export type GithubAppCredentials = {
  appId: string;
  privateKey: string;
  installationId: string;
  org: string;
  clientId: string;
  clientSecret: string;
};

export type GithubDeps = {
  fetch: typeof fetch;
  credentials: GithubAppCredentials;
  now?: () => Date;
};

/** Read GitHub App creds from env; null if not fully configured. */
export function githubAppCredentialsFromEnv(): GithubAppCredentials | null {
  const appId = process.env.GITHUB_APP_ID;
  // Private keys in env keep literal "\n"; restore real newlines for the PEM parser.
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const org = process.env.GITHUB_ORG;
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!appId || !privateKey || !installationId || !org || !clientId || !clientSecret) return null;
  return { appId, privateKey, installationId, org, clientId, clientSecret };
}

/** Presence booleans for the `not_configured` response; never expose values. */
export function githubAppConfigPresence(): Record<keyof GithubAppCredentials, boolean> {
  return {
    appId: Boolean(process.env.GITHUB_APP_ID),
    privateKey: Boolean(process.env.GITHUB_APP_PRIVATE_KEY),
    installationId: Boolean(process.env.GITHUB_APP_INSTALLATION_ID),
    org: Boolean(process.env.GITHUB_ORG),
    clientId: Boolean(process.env.GITHUB_APP_CLIENT_ID),
    clientSecret: Boolean(process.env.GITHUB_APP_CLIENT_SECRET),
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Signed RS256 App JWT — the bearer credential itself (not a grant, unlike
 * Google's), exchanged at the per-installation access-tokens endpoint. `iat`
 * is set 60s in the past per GitHub's own clock-skew recommendation; `exp` is
 * capped at GitHub's 10-minute max (we use 9).
 */
export function buildGithubAppJwt(creds: GithubAppCredentials, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iat, exp: iat + 600, iss: creds.appId }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(creds.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

// One installation token is reused for every call sharing the same `deps`
// object, exactly like google-directory.ts's tokenCache: a reconcile run
// builds a single `deps` and threads it through every list/add/remove, so
// the whole run costs one token exchange. Keyed by object identity via a
// WeakMap so cached promises are collected with their deps and never leak.
const tokenCache = new WeakMap<GithubDeps, Promise<string>>();

/** Exchange the App JWT for a 1h installation access token (cached per `deps`). */
export function fetchInstallationToken(deps: GithubDeps): Promise<string> {
  const cached = tokenCache.get(deps);
  if (cached) return cached;
  const promise = (async () => {
    const jwt = buildGithubAppJwt(deps.credentials, (deps.now ?? (() => new Date()))());
    const res = await deps.fetch(
      `https://api.github.com/app/installations/${deps.credentials.installationId}/access_tokens`,
      {
        method: "POST",
        headers: { ...githubHeaders(jwt), "Content-Type": "application/json" },
      },
    );
    if (!res.ok) throw new Error(`installation token request failed: ${res.status}`);
    const json = (await res.json()) as { token?: string };
    if (!json.token) throw new Error("installation token response had no token");
    return json.token;
  })();
  tokenCache.set(deps, promise);
  return promise;
}

/** Standard headers for every GitHub REST call. */
export function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rar1741-hub",
    Authorization: `Bearer ${token}`,
  };
}
