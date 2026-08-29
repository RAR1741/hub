"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/realtime-browser-client";

const DEBOUNCE_MS = 2000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const MIN_REFRESH_MS = 60_000;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 60_000;
const DEFAULT_FALLBACK_MS = 5 * 60 * 1000;

/** Capped exponential backoff delay (ms) for the Nth (0-indexed) retry attempt. */
export function nextBackoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
}

/**
 * Pure retry-attempt counter, kept outside `connect()` so a successful token
 * fetch can never reset it: only an actual `SUBSCRIBED` (via `onJoinSuccess`)
 * resets the count. `connect()` re-running after a token-fetch failure or a
 * channel-join failure both go through `onJoinFailure`, so escalation is
 * shared across both failure kinds, same as before this was extracted.
 */
export function createRetryState() {
  let attempt = 0;
  return {
    /** Returns the delay (ms) to wait before the next retry, then advances the attempt. */
    onJoinFailure(): number {
      const delay = nextBackoff(attempt);
      attempt += 1;
      return delay;
    },
    onJoinSuccess(): void {
      attempt = 0;
    },
  };
}

/**
 * Pure decision for a channel's subscribe-status callback, factored out for
 * testability the same way createRetryState/throttle are.
 *
 * `current` is whether this status came from the channel we still consider
 * active. `supabase.removeChannel()` unsubscribes asynchronously (a server
 * round-trip), and the resulting `CLOSED` status arrives via that same async
 * path — so a channel we've already torn down (reconnect, or unmount) keeps
 * emitting `CLOSED` after we've moved on. Those must be ignored, or our own
 * teardown would trigger a retry storm.
 */
export function subscribeStatusAction(
  status: string,
  current: boolean,
): "joined" | "retry" | "ignore" {
  if (!current) return "ignore";
  if (status === "SUBSCRIBED") return "joined";
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") return "retry";
  return "ignore";
}

/**
 * Leading+trailing throttle: the first call runs immediately, further calls
 * within `ms` are coalesced into a single trailing call at the end of the
 * window. Guarantees `fn` runs at most once per `ms`.
 */
export function throttle(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const call = () => {
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed >= ms) {
      last = now;
      fn();
    } else if (!timer) {
      timer = setTimeout(
        () => {
          timer = null;
          last = Date.now();
          fn();
        },
        ms - elapsed,
      );
    }
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return { call, cancel };
}

type TokenResponse = { token: string; expiresAt: number };

/**
 * Subscribes to a private Supabase Realtime broadcast `topic` and calls
 * `refetch` (throttled) whenever any event arrives. Always keeps a fallback
 * poll running as a correctness backstop, and degrades gracefully (poll-only)
 * if the browser client can't be created, the token route fails, or the
 * channel errors — see docs/superpowers/specs/2026-08-28-realtime-broadcast-design.md.
 */
export function useRealtimeRefetch(
  topic: string,
  refetch: () => void,
  opts?: { fallbackMs?: number },
): void {
  const fallbackMs = opts?.fallbackMs ?? DEFAULT_FALLBACK_MS;
  const refetchRef = useRef(refetch);
  const fallbackMsRef = useRef(fallbackMs);
  useEffect(() => {
    refetchRef.current = refetch;
    fallbackMsRef.current = fallbackMs;
  });

  useEffect(() => {
    const fallback = setInterval(() => refetchRef.current(), fallbackMsRef.current);

    const client = browserSupabase();
    if (!client) return () => clearInterval(fallback);
    const supabase = client;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const retryState = createRetryState();
    const throttled = throttle(() => refetchRef.current(), DEBOUNCE_MS);

    const clearRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
    };
    const clearRetry = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
    const teardownChannel = () => {
      if (channel) supabase.removeChannel(channel);
      channel = null;
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      clearRetry();
      const delay = retryState.onJoinFailure();
      retryTimer = setTimeout(() => void connect(), delay);
    };

    async function fetchToken(): Promise<TokenResponse> {
      const res = await fetch("/api/realtime-token", { cache: "no-store" });
      if (!res.ok) throw new Error(`realtime token fetch failed: ${res.status}`);
      return res.json();
    }

    function scheduleTokenRefresh(expiresAt: number) {
      clearRefresh();
      // Floor at MIN_REFRESH_MS, not 0: a kiosk clock skewed ahead of the
      // server would otherwise compute ~0 forever, refreshing in a tight loop.
      const refreshIn = Math.max(expiresAt - Date.now() - REFRESH_SKEW_MS, MIN_REFRESH_MS);
      refreshTimer = setTimeout(() => void refreshToken(), refreshIn);
    }

    async function refreshToken() {
      if (cancelled) return;
      try {
        const { token, expiresAt } = await fetchToken();
        if (cancelled) return;
        supabase.realtime.setAuth(token);
        scheduleTokenRefresh(expiresAt);
      } catch {
        scheduleRetry();
      }
    }

    async function connect() {
      if (cancelled) return;
      let tokenData: TokenResponse;
      try {
        tokenData = await fetchToken();
      } catch {
        scheduleRetry();
        return;
      }
      if (cancelled) return;
      supabase.realtime.setAuth(tokenData.token);
      scheduleTokenRefresh(tokenData.expiresAt);

      teardownChannel();
      const thisChannel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "*" }, () => throttled.call());
      channel = thisChannel;
      thisChannel.subscribe((status) => {
        if (cancelled) return;
        switch (subscribeStatusAction(status, channel === thisChannel)) {
          case "joined":
            retryState.onJoinSuccess();
            refetchRef.current();
            break;
          case "retry":
            teardownChannel();
            scheduleRetry();
            break;
          case "ignore":
            break;
        }
      });
    }

    void connect();

    return () => {
      cancelled = true;
      clearInterval(fallback);
      clearRefresh();
      clearRetry();
      throttled.cancel();
      teardownChannel();
    };
  }, [topic]);
}
