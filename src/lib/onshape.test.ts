import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  clientId,
  discardOnshapeToken,
  normalizeServer,
  buildAuthorizeUrl,
  exchangeCode,
  getFreshAccessToken,
  listElementParts,
} from "./onshape";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.ONSHAPE_CLIENT_ID = "1O0client";
  process.env.ONSHAPE_CLIENT_SECRET = "secret";
  process.env.ONSHAPE_REDIRECT_URI = "https://hub.example.com/callback";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("clientId", () => {
  test("replaces every 0 with O (Onshape quirk)", () => {
    expect(clientId()).toBe("1OOclient");
  });
});

describe("discardOnshapeToken", () => {
  test("discards an unsubstituted template token", () => {
    expect(discardOnshapeToken("{$partId}")).toBeUndefined();
  });

  test("passes through a real value", () => {
    expect(discardOnshapeToken("abc")).toBe("abc");
  });

  test("takes the first element of an array", () => {
    expect(discardOnshapeToken(["x", "y"])).toBe("x");
  });

  test("trims whitespace before checking the template pattern", () => {
    expect(discardOnshapeToken("  {$foo} ")).toBeUndefined();
  });

  test("passes through a value with an embedded (non-matching) token pattern", () => {
    expect(discardOnshapeToken("a{$b}c")).toBe("a{$b}c");
  });

  test("undefined and empty string both become undefined", () => {
    expect(discardOnshapeToken(undefined)).toBeUndefined();
    expect(discardOnshapeToken("   ")).toBeUndefined();
  });
});

describe("normalizeServer", () => {
  test("accepts an onshape.com host", () => {
    expect(normalizeServer("https://cad.onshape.com/api")).toBe("https://cad.onshape.com/api");
  });

  test("accepts a bare onshape.com host, adding a scheme", () => {
    expect(normalizeServer("onshape.com")).toBe("https://onshape.com");
  });

  test("rejects an unrelated host, falling back to the default", () => {
    expect(normalizeServer("https://evil.com")).toBe("https://cad.onshape.com/api");
  });

  test("rejects an unsubstituted template token, falling back to the default", () => {
    expect(normalizeServer("{$server}")).toBe("https://cad.onshape.com/api");
  });

  test("falls back to the default when undefined", () => {
    expect(normalizeServer(undefined)).toBe("https://cad.onshape.com/api");
  });
});

describe("buildAuthorizeUrl", () => {
  test("includes the expected query params", () => {
    const url = new URL(buildAuthorizeUrl("state123"));
    expect(url.origin + url.pathname).toBe("https://oauth.onshape.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("1OOclient");
    expect(url.searchParams.get("redirect_uri")).toBe("https://hub.example.com/callback");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("scope")).toBe("OAuth2Read");
  });
});

describe("exchangeCode", () => {
  test("maps a successful token response", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    );
    const before = Date.now();
    const tokens = await exchangeCode("code123", fetchFn as unknown as typeof fetch);
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(before + 3500 * 1000);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  test("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }));
    await expect(exchangeCode("bad", fetchFn as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("getFreshAccessToken", () => {
  function stubDb(row: Record<string, unknown> | null) {
    const maybeSingle = vi.fn(async () => ({ data: row }));
    const upsert = vi.fn(async () => ({ data: null, error: null }));
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle,
      upsert,
    };
    return { from: () => chain, __upsert: upsert } as unknown as import("@supabase/supabase-js").SupabaseClient & {
      __upsert: typeof upsert;
    };
  }

  test("returns the stored token without calling fetch when still fresh", async () => {
    const db = stubDb({
      id: "c1",
      person_id: "p1",
      access_token: "fresh-at",
      refresh_token: "rt",
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const fetchFn = vi.fn();
    const token = await getFreshAccessToken("p1", fetchFn as unknown as typeof fetch, db);
    expect(token).toBe("fresh-at");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("refreshes and updates when expired", async () => {
    const db = stubDb({
      id: "c1",
      person_id: "p1",
      access_token: "stale-at",
      refresh_token: "rt",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }),
    );
    const token = await getFreshAccessToken("p1", fetchFn as unknown as typeof fetch, db);
    expect(token).toBe("new-at");
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(db.__upsert).toHaveBeenCalledOnce();
  });

  test("returns null when refresh fails (4xx)", async () => {
    const db = stubDb({
      id: "c1",
      person_id: "p1",
      access_token: "stale-at",
      refresh_token: "rt",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const fetchFn = vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }));
    const token = await getFreshAccessToken("p1", fetchFn as unknown as typeof fetch, db);
    expect(token).toBeNull();
  });

  test("returns null when there's no connection", async () => {
    const db = stubDb(null);
    const token = await getFreshAccessToken("p1", (vi.fn() as unknown) as typeof fetch, db);
    expect(token).toBeNull();
  });
});

describe("listElementParts", () => {
  function stubDb(row: Record<string, unknown> | null) {
    const maybeSingle = vi.fn(async () => ({ data: row }));
    const upsert = vi.fn(async () => ({ data: null, error: null }));
    const chain = { select: () => chain, eq: () => chain, maybeSingle, upsert };
    return { from: () => chain } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }

  const freshRow = {
    id: "c1",
    person_id: "p1",
    access_token: "at",
    refresh_token: "rt",
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ctx = {
    documentId: "doc1",
    wvm: "w" as const,
    wvmId: "wid1",
    elementId: "el1",
  };

  test("happy path maps fields", async () => {
    const db = stubDb(freshRow);
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, [
        { partId: "PID1", name: "Bracket", material: { displayName: "6061-T6" }, partNumber: "AB-1" },
        { partId: "PID2", name: "Plate", material: null, partNumber: null },
      ]),
    );
    const result = await listElementParts("p1", ctx, fetchFn as unknown as typeof fetch, db);
    expect(result).toEqual({
      parts: [
        { partId: "PID1", name: "Bracket", material: "6061-T6", onshapePartNumber: "AB-1" },
        { partId: "PID2", name: "Plate", material: null, onshapePartNumber: null },
      ],
    });
  });

  test("401 triggers a refresh-and-retry; still failing returns needsReconnect", async () => {
    const db = stubDb(freshRow);
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth/token")) {
        return jsonResponse(200, { access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 });
      }
      return jsonResponse(401, { error: "unauthorized" });
    });
    const result = await listElementParts("p1", ctx, fetchFn as unknown as typeof fetch, db);
    expect(result).toEqual({ needsReconnect: true });
  });

  test("no connection returns needsReconnect", async () => {
    const db = stubDb(null);
    const fetchFn = vi.fn();
    const result = await listElementParts("p1", ctx, fetchFn as unknown as typeof fetch, db);
    expect(result).toEqual({ needsReconnect: true });
  });

  test("500 is a transient error, not needsReconnect", async () => {
    const db = stubDb(freshRow);
    const fetchFn = vi.fn(async () => jsonResponse(500, { error: "server_error" }));
    const result = await listElementParts("p1", ctx, fetchFn as unknown as typeof fetch, db);
    expect(result).toEqual({ error: "fetch_failed" });
  });

  test("429 is a transient error, not needsReconnect", async () => {
    const db = stubDb(freshRow);
    const fetchFn = vi.fn(async () => jsonResponse(429, { error: "rate_limited" }));
    const result = await listElementParts("p1", ctx, fetchFn as unknown as typeof fetch, db);
    expect(result).toEqual({ error: "fetch_failed" });
  });
});
