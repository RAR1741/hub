"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/realtime-browser-client";

const DEBOUNCE_MS = 2000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 60_000;
const DEFAULT_FALLBACK_MS = 5 * 60 * 1000;

/** Capped exponential backoff delay (ms) for the Nth (0-indexed) retry attempt. */
export function nextBackoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
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
    let attempt = 0;
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
      const delay = nextBackoff(attempt);
      attempt += 1;
      retryTimer = setTimeout(() => void connect(), delay);
    };

    async function fetchToken(): Promise<TokenResponse> {
      const res = await fetch("/api/realtime-token", { cache: "no-store" });
      if (!res.ok) throw new Error(`realtime token fetch failed: ${res.status}`);
      return res.json();
    }

    function scheduleTokenRefresh(expiresAt: number) {
      clearRefresh();
      const refreshIn = Math.max(expiresAt - Date.now() - REFRESH_SKEW_MS, 0);
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
      attempt = 0;
      supabase.realtime.setAuth(tokenData.token);
      scheduleTokenRefresh(tokenData.expiresAt);

      teardownChannel();
      channel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "*" }, () => throttled.call())
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            attempt = 0;
            refetchRef.current();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            teardownChannel();
            scheduleRetry();
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
