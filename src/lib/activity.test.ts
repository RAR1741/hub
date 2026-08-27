import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStore,
  dismissError,
  getSnapshot,
  installFetchPatch,
  resetForTests,
  shouldTrack,
  subscribe,
  type Store,
} from "./activity";

describe("shouldTrack", () => {
  const origin = "https://hub.example.org";
  const h = (entries?: Record<string, string>) => new Headers(entries);

  it("tracks a same-origin /api/ string url", () => {
    expect(shouldTrack("/api/x", h(), origin)).toBe(true);
  });

  it("extracts the url from a Request object", () => {
    const req = new Request(`${origin}/api/x`);
    expect(shouldTrack(req.url, h(), origin)).toBe(true);
  });

  it("tracks an rsc:1 request outside /api/", () => {
    expect(shouldTrack("/dashboard", h({ rsc: "1" }), origin)).toBe(true);
  });

  it("skips next-router-prefetch regardless of value", () => {
    expect(shouldTrack("/api/x", h({ "next-router-prefetch": "2" }), origin)).toBe(false);
  });

  it("skips next-hmr-refresh", () => {
    expect(shouldTrack("/api/x", h({ "next-hmr-refresh": "1" }), origin)).toBe(false);
  });

  it("skips cross-origin urls", () => {
    expect(shouldTrack("https://other.example.org/api/x", h(), origin)).toBe(false);
  });

  it("skips a non-api same-origin page path with no rsc header", () => {
    expect(shouldTrack("/dashboard", h(), origin)).toBe(false);
  });

  it("lets init.headers override a Request's own headers", () => {
    const req = new Request(`${origin}/api/x`, { headers: { rsc: "1" } });
    // init.headers replaces (doesn't merge with) the Request's headers, matching fetch semantics.
    const info = new Headers({ "next-router-prefetch": "3" });
    expect(shouldTrack(req.url, info, origin)).toBe(false);
  });
});

describe("fetch patch", () => {
  const origin = "https://hub.example.org";

  beforeEach(() => {
    resetForTests();
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", { origin });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decrements the in-flight count on resolve, reject, and non-2xx (finally semantics)", async () => {
    let calls = 0;
    const ok = vi.fn(async () => new Response("ok", { status: 200 }));
    const bad = vi.fn(async () => new Response("nope", { status: 500 }));
    const boom = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls++;
      const url = input.toString();
      if (url.includes("ok")) return ok();
      if (url.includes("bad")) return bad();
      return boom();
    }));
    installFetchPatch();

    await fetch(`${origin}/api/ok`);
    await fetch(`${origin}/api/bad`);
    await expect(fetch(`${origin}/api/boom`)).rejects.toThrow("network down");
    expect(calls).toBe(3);
  });

  it("re-throws the original rejection unchanged", async () => {
    const err = new Error("kaboom");
    vi.stubGlobal("fetch", vi.fn(async () => { throw err; }));
    installFetchPatch();
    await expect(fetch(`${origin}/api/x`)).rejects.toBe(err);
  });

  it("returns the exact original response object", async () => {
    const res = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => res));
    installFetchPatch();
    const got = await fetch(`${origin}/api/x`);
    expect(got).toBe(res);
  });

  it("wraps fetch only once across repeated installFetchPatch() calls", () => {
    const original = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", original);
    installFetchPatch();
    const wrapped = globalThis.fetch;
    installFetchPatch();
    expect(globalThis.fetch).toBe(wrapped);
  });
});

describe("state machine", () => {
  let store: Store;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a GET settling before the show delay never leaves idle", () => {
    store.started(false);
    vi.advanceTimersByTime(200);
    store.settled(false, true);
    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("a GET past the show delay becomes loading, then honors the min-visible floor", () => {
    store.started(false);
    vi.advanceTimersByTime(250);
    expect(store.getSnapshot().phase).toBe("loading");

    store.settled(false, true); // settles immediately after becoming visible
    expect(store.getSnapshot().phase).toBe("loading"); // still holding for MIN_VISIBLE
    vi.advanceTimersByTime(499);
    expect(store.getSnapshot().phase).toBe("loading");
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("a mutation in flight shows saving", () => {
    store.started(true);
    vi.advanceTimersByTime(250);
    expect(store.getSnapshot().phase).toBe("saving");
  });

  it("a successful mutation flashes saved for 2000ms then idles", () => {
    store.started(true);
    vi.advanceTimersByTime(250);
    store.settled(true, true);
    expect(store.getSnapshot().phase).toBe("saved");
    vi.advanceTimersByTime(1999);
    expect(store.getSnapshot().phase).toBe("saved");
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("a fast save (settles before the show delay) still flashes saved", () => {
    store.started(true);
    vi.advanceTimersByTime(100);
    store.settled(true, true);
    expect(store.getSnapshot().phase).toBe("saved");
  });

  it("a failed mutation goes to error", () => {
    store.started(true);
    vi.advanceTimersByTime(250);
    store.settled(true, false);
    expect(store.getSnapshot().phase).toBe("error");
  });

  it("error clears on the next tracked request start", () => {
    store.started(true);
    store.settled(true, false);
    expect(store.getSnapshot().phase).toBe("error");
    store.started(false);
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("error clears via dismissError()", () => {
    store.started(true);
    store.settled(true, false);
    expect(store.getSnapshot().phase).toBe("error");
    store.dismissError();
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("a new request during the saved flash cuts it immediately", () => {
    store.started(true);
    store.settled(true, true);
    expect(store.getSnapshot().phase).toBe("saved");
    store.started(false);
    expect(store.getSnapshot().phase).toBe("idle");
  });
});

describe("module-level exports wire to the singleton store", () => {
  beforeEach(() => resetForTests());

  it("subscribe/getSnapshot/dismissError proxy to the same store", () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    expect(getSnapshot().phase).toBe("idle");
    dismissError(); // no-op while idle, shouldn't throw
    unsubscribe();
    expect(cb).not.toHaveBeenCalled();
  });
});
