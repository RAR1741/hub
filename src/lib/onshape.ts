import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnshapeConnection, OnshapeConnectionRow } from "./types";
import { onshapeConnectionFromRow } from "./types";

const DEFAULT_AUTHORIZATION_URL = "https://oauth.onshape.com/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://oauth.onshape.com/oauth/token";
const DEFAULT_API_BASE_URL = "https://cad.onshape.com/api";
const DEFAULT_SCOPES = "OAuth2Read";

/** Env-driven Onshape config (spec §6). */
export function onshapeConfig() {
  return {
    clientId: process.env.ONSHAPE_CLIENT_ID ?? "",
    clientSecret: process.env.ONSHAPE_CLIENT_SECRET ?? "",
    redirectUri: process.env.ONSHAPE_REDIRECT_URI ?? "",
    authorizationUrl: process.env.ONSHAPE_AUTHORIZATION_URL ?? DEFAULT_AUTHORIZATION_URL,
    tokenUrl: process.env.ONSHAPE_TOKEN_URL ?? DEFAULT_TOKEN_URL,
    apiBaseUrl: process.env.ONSHAPE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    scopes: process.env.ONSHAPE_SCOPES ?? DEFAULT_SCOPES,
  };
}

/** Onshape client-id quirk: every literal `0` in the configured id must be `O`. */
export function clientId(): string {
  return onshapeConfig().clientId.replaceAll("0", "O");
}

/**
 * Onshape leaves an unsubstituted right-panel param as the literal template
 * token (e.g. `{$partId}`) when it has no value for the current context.
 * Discards that; otherwise returns the trimmed value (undefined if empty).
 * Array values (repeated query params) take the first element.
 */
export function discardOnshapeToken(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (/^\{\$[^}]+\}$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Only trust a `server` override if it names an onshape.com host — otherwise
 * fall back to the configured API base (defends against an attacker-supplied
 * `server` query param redirecting API calls off-origin).
 */
export function normalizeServer(v: string | undefined): string {
  const value = discardOnshapeToken(v);
  const fallback = onshapeConfig().apiBaseUrl;
  if (!value) return fallback;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  let host: string;
  try {
    host = new URL(withScheme).host.toLowerCase();
  } catch {
    return fallback;
  }
  // The panel passes the CAD app origin (e.g. https://cad.onshape.com), not
  // an API base — rebuild from the validated host only (dropping any
  // attacker-supplied path/query) so the result is always `https://<host>/api`.
  if (host === "onshape.com" || host.endsWith(".onshape.com")) return `https://${host}/api`;
  return fallback;
}

/** Authorize URL for the OAuth2 authorization-code flow. */
export function buildAuthorizeUrl(state: string): string {
  const config = onshapeConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: config.redirectUri,
    state,
    scope: config.scopes.split(/\s+/).filter(Boolean).join(" "),
  });
  return `${config.authorizationUrl}?${params.toString()}`;
}

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

async function postTokenRequest(
  body: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<TokenSet> {
  const config = onshapeConfig();
  const res = await fetchFn(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`Onshape token request failed: ${res.status}`);
  }
  const json = (await res.json()) as TokenResponse;
  // Store the true expiry — the 60s safety margin is applied once, at read
  // time, in getFreshAccessToken.
  const expiresAt = new Date(Date.now() + json.expires_in * 1000);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt,
  };
}

export async function exchangeCode(code: string, fetchFn: typeof fetch = fetch): Promise<TokenSet> {
  const config = onshapeConfig();
  return postTokenRequest(
    {
      grant_type: "authorization_code",
      code,
      client_id: clientId(),
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    },
    fetchFn,
  );
}

async function refreshTokens(refreshToken: string, fetchFn: typeof fetch): Promise<TokenSet> {
  const config = onshapeConfig();
  return postTokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: config.clientSecret,
    },
    fetchFn,
  );
}

export async function upsertConnection(
  personId: string,
  tokens: TokenSet,
  db?: SupabaseClient,
): Promise<void> {
  const client = db ?? (await import("./db")).getDb();
  await client.from("onshape_connection").upsert(
    {
      person_id: personId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "person_id" },
  );
}

export async function getConnection(
  personId: string,
  db?: SupabaseClient,
): Promise<OnshapeConnection | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("onshape_connection")
    .select("*")
    .eq("person_id", personId)
    .maybeSingle();
  return data ? onshapeConnectionFromRow(data as OnshapeConnectionRow) : null;
}

/**
 * Fresh (<=60s from expiry is treated as expired) access token for `personId`,
 * refreshing and persisting a new one if needed. Null when there's no
 * connection, or the refresh itself fails (caller surfaces needs_reconnect).
 */
export async function getFreshAccessToken(
  personId: string,
  fetchFn: typeof fetch = fetch,
  db?: SupabaseClient,
): Promise<string | null> {
  const connection = await getConnection(personId, db);
  if (!connection) return null;

  if (new Date(connection.expiresAt).getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  try {
    const tokens = await refreshTokens(connection.refreshToken, fetchFn);
    await upsertConnection(personId, tokens, db);
    return tokens.accessToken;
  } catch (error) {
    console.error("[onshape] token refresh failed", error);
    return null;
  }
}

export type ElementPart = {
  partId: string;
  name: string;
  material: string | null;
  onshapePartNumber: string | null;
};

export type ListElementPartsContext = {
  documentId: string;
  wvm: "w" | "v" | "m";
  wvmId: string;
  elementId: string;
  server?: string;
};

type OnshapeApiPart = {
  partId: string;
  name: string;
  material?: { displayName?: string; name?: string } | null;
  partNumber?: string | null;
};

function mapApiPart(p: OnshapeApiPart): ElementPart {
  return {
    partId: p.partId,
    name: p.name,
    material: p.material?.displayName ?? p.material?.name ?? null,
    onshapePartNumber: p.partNumber ?? null,
  };
}

function buildPartsUrl(ctx: ListElementPartsContext): string {
  const base = normalizeServer(ctx.server);
  const params = new URLSearchParams({
    elementId: ctx.elementId,
    includePropertyDefaults: "false",
    withThumbnails: "false",
  });
  return `${base}/v6/parts/d/${ctx.documentId}/${ctx.wvm}/${ctx.wvmId}?${params.toString()}`;
}

async function fetchElementParts(
  accessToken: string,
  ctx: ListElementPartsContext,
  fetchFn: typeof fetch,
): Promise<Response> {
  const url = buildPartsUrl(ctx);
  return fetchFn(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
}

/** Logs a non-ok parts-fetch response's status + body so `fetch_failed` is diagnosable. */
async function logPartsFetchFailure(
  label: "initial" | "after refresh-retry",
  ctx: ListElementPartsContext,
  res: Response,
): Promise<void> {
  const body = await res.text().catch((error: unknown) => `<failed to read body: ${String(error)}>`);
  console.error("[onshape] parts fetch failed", {
    attempt: label,
    method: "GET",
    url: buildPartsUrl(ctx),
    status: res.status,
    statusText: res.statusText,
    body,
  });
}

export async function listElementParts(
  personId: string,
  ctx: ListElementPartsContext,
  fetchFn: typeof fetch = fetch,
  db?: SupabaseClient,
): Promise<{ needsReconnect: true } | { error: "fetch_failed" } | { parts: ElementPart[] }> {
  const accessToken = await getFreshAccessToken(personId, fetchFn, db);
  if (!accessToken) return { needsReconnect: true };

  let res: Response;
  let wasRetried = false;
  try {
    res = await fetchElementParts(accessToken, ctx, fetchFn);
  } catch (error) {
    console.error("[onshape] parts fetch threw", {
      attempt: "initial",
      error: error instanceof Error ? error.message : String(error),
      documentId: ctx.documentId,
      wvm: ctx.wvm,
      wvmId: ctx.wvmId,
      elementId: ctx.elementId,
      base: normalizeServer(ctx.server),
    });
    return { error: "fetch_failed" };
  }
  if (res.status === 401 || res.status === 403) {
    await logPartsFetchFailure("initial", ctx, res);
    // One refresh-and-retry: the stored token may have been revoked
    // server-side even though our local expiry hadn't yet elapsed, so force
    // a refresh rather than reusing the (still locally-fresh) cached token.
    const connection = await getConnection(personId, db);
    if (!connection) return { needsReconnect: true };
    let retryToken: string;
    try {
      const tokens = await refreshTokens(connection.refreshToken, fetchFn);
      await upsertConnection(personId, tokens, db);
      retryToken = tokens.accessToken;
    } catch (error) {
      console.error("[onshape] token refresh failed", error);
      return { needsReconnect: true };
    }
    try {
      res = await fetchElementParts(retryToken, ctx, fetchFn);
      wasRetried = true;
    } catch (error) {
      console.error("[onshape] parts fetch threw", {
        attempt: "after refresh-retry",
        error: error instanceof Error ? error.message : String(error),
        documentId: ctx.documentId,
        wvm: ctx.wvm,
        wvmId: ctx.wvmId,
        elementId: ctx.elementId,
        base: normalizeServer(ctx.server),
      });
      return { error: "fetch_failed" };
    }
    if (res.status === 401 || res.status === 403) {
      await logPartsFetchFailure("after refresh-retry", ctx, res);
      return { needsReconnect: true };
    }
  }
  // Any other non-2xx (5xx, 429, ...) is a transient/unexpected failure, not
  // a reason to send the user through OAuth again.
  if (!res.ok) {
    await logPartsFetchFailure(wasRetried ? "after refresh-retry" : "initial", ctx, res);
    return { error: "fetch_failed" };
  }

  // A 200 with a non-JSON body (e.g. Onshape's SPA HTML shell, when a
  // misconfigured base URL points at the app origin instead of /api) must
  // degrade gracefully rather than throw an unhandled 500.
  const bodyText = await res.text();
  let json: OnshapeApiPart[];
  try {
    json = JSON.parse(bodyText) as OnshapeApiPart[];
  } catch (error) {
    console.error("[onshape] parts response was not JSON", {
      url: buildPartsUrl(ctx),
      status: res.status,
      error: error instanceof Error ? error.message : String(error),
      bodySnippet: bodyText.slice(0, 200),
    });
    return { error: "fetch_failed" };
  }
  return { parts: json.map(mapApiPart) };
}
