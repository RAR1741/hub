// Site-wide background activity indicator: a DOM-free singleton store fed by a
// patched `fetch`, exposed via the useSyncExternalStore contract so any client
// component can subscribe without prop drilling.

export type Phase = "idle" | "loading" | "saving" | "saved" | "error";
export type Snapshot = { phase: Phase };

const SHOW_DELAY = 250; // ms before a hidden burst becomes visible
const MIN_VISIBLE = 500; // ms a visible "loading" must stay up once shown
const SAVED_FLASH = 2000; // ms the "saved" confirmation stays up

const SERVER_SNAPSHOT: Snapshot = Object.freeze({ phase: "idle" });

export interface Store {
  patched: boolean;
  subscribe(cb: () => void): () => void;
  getSnapshot(): Snapshot;
  getServerSnapshot(): Snapshot;
  dismissError(): void;
  started(isMutation: boolean): void;
  settled(isMutation: boolean, ok: boolean): void;
}

export function createStore(): Store {
  let phase: Phase = "idle";
  let snapshot: Snapshot = { phase };
  let count = 0;
  let nonGetCount = 0;
  let sawMutationOk = false;
  let sawMutationFail = false;
  let shownAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function setPhase(next: Phase) {
    if (phase === next) return;
    phase = next;
    snapshot = { phase }; // new reference only on real change (useSyncExternalStore contract)
    for (const l of listeners) l();
  }

  return {
    patched: false,

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    getSnapshot() {
      return snapshot;
    },

    getServerSnapshot() {
      return SERVER_SNAPSHOT;
    },

    dismissError() {
      if (phase === "error") {
        clearTimer();
        setPhase("idle");
      }
    },

    started(isMutation) {
      // A new request cuts a standing error or a "saved" flash immediately.
      if (phase === "error" || phase === "saved") {
        clearTimer();
        setPhase("idle");
      }

      count++;
      if (isMutation) nonGetCount++;

      if (count === 1) {
        // Burst start: hidden for SHOW_DELAY so quick GETs never flicker.
        sawMutationOk = false;
        sawMutationFail = false;
        shownAt = null;
        clearTimer();
        timer = setTimeout(() => {
          timer = null;
          if (count > 0) {
            shownAt = Date.now();
            setPhase(nonGetCount > 0 ? "saving" : "loading");
          }
        }, SHOW_DELAY);
      } else if (phase === "loading" || phase === "saving") {
        setPhase(nonGetCount > 0 ? "saving" : "loading");
      }
    },

    // ponytail: settle = response headers resolved, not body-stream end, so a
    // long streaming RSC response clears the indicator slightly early. Upgrade
    // path: count a TransformStream on res.body instead, not worth it now.
    settled(isMutation, ok) {
      count--;
      if (isMutation) {
        nonGetCount--;
        if (ok) sawMutationOk = true;
        else sawMutationFail = true;
      }

      if (count > 0) {
        if (phase === "loading" || phase === "saving") {
          setPhase(nonGetCount > 0 ? "saving" : "loading");
        }
        return;
      }

      // count === 0: still-idle phase here means we were in the hidden
      // (pending) window — a burst is only tracked while count > 0.
      const wasHiddenPending = phase === "idle";
      clearTimer();

      if (sawMutationFail) {
        setPhase("error");
        return;
      }

      if (sawMutationOk) {
        setPhase("saved"); // MIN_VISIBLE never gates the saved flash
        timer = setTimeout(() => {
          timer = null;
          setPhase("idle");
        }, SAVED_FLASH);
        return;
      }

      if (wasHiddenPending) {
        setPhase("idle"); // GET-only burst settled before it ever showed
        return;
      }

      const elapsed = shownAt !== null ? Date.now() - shownAt : MIN_VISIBLE;
      if (elapsed >= MIN_VISIBLE) {
        setPhase("idle");
      } else {
        timer = setTimeout(() => {
          timer = null;
          setPhase("idle");
        }, MIN_VISIBLE - elapsed);
      }
    },
  };
}

const g = globalThis as unknown as { __hubActivity?: Store };
let store = (g.__hubActivity ??= createStore());

/** Test-only: swap in a fresh store (and clear the globalThis singleton). */
export function resetForTests(): void {
  store = createStore();
  g.__hubActivity = store;
}

export const subscribe = (cb: () => void) => store.subscribe(cb);
export const getSnapshot = () => store.getSnapshot();
export const getServerSnapshot = () => store.getServerSnapshot();
export const dismissError = () => store.dismissError();

export function shouldTrack(url: string, headers: Headers, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  // Presence checks — Next's prefetch headers carry a version value ('1'|'2'|'3'), never compare to a literal.
  if (headers.has("next-router-prefetch")) return false;
  if (headers.has("next-router-segment-prefetch")) return false;
  if (headers.has("next-hmr-refresh")) return false;
  return u.pathname.startsWith("/api/") || headers.get("rsc") === "1";
}

function requestInfo(input: RequestInfo | URL, init?: RequestInit) {
  const isReq = typeof Request !== "undefined" && input instanceof Request;
  const req = isReq ? (input as Request) : null;
  const url = req ? req.url : input.toString();
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? req?.headers);
  return { url, method, headers };
}

export function installFetchPatch(): void {
  if (store.patched || typeof window === "undefined") return;
  store.patched = true;

  const original = globalThis.fetch;
  globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const info = requestInfo(input, init);
    if (!shouldTrack(info.url, info.headers, location.origin)) return original(input, init);

    const isMutation = info.method !== "GET" && info.method !== "HEAD";
    store.started(isMutation);
    return original(input, init).then(
      (res) => {
        store.settled(isMutation, res.ok);
        return res;
      },
      (err) => {
        store.settled(isMutation, false);
        throw err;
      },
    );
  };
}
