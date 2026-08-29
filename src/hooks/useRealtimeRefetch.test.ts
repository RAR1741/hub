import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetryState, nextBackoff, throttle } from "./useRealtimeRefetch";

describe("createRetryState", () => {
  it("escalates the backoff delay across repeated join failures", () => {
    const retry = createRetryState();
    expect(retry.onJoinFailure()).toBe(2000);
    expect(retry.onJoinFailure()).toBe(4000);
    expect(retry.onJoinFailure()).toBe(8000);
    expect(retry.onJoinFailure()).toBe(16_000);
  });

  it("does not reset on its own — only onJoinSuccess resets it", () => {
    // Regression test: connect() used to reset the attempt counter right
    // after a successful token fetch, before the channel join could fail.
    // With the token fetch outside this state entirely, nothing but an
    // actual SUBSCRIBED can reset it, so repeated CHANNEL_ERROR/TIMED_OUT
    // cycles (each a fresh connect() call) keep escalating instead of
    // pinning at the base delay forever.
    const retry = createRetryState();
    retry.onJoinFailure();
    retry.onJoinFailure();
    expect(retry.onJoinFailure()).toBe(8000);
  });

  it("resets to the base delay after a successful join", () => {
    const retry = createRetryState();
    retry.onJoinFailure();
    retry.onJoinFailure();
    retry.onJoinSuccess();
    expect(retry.onJoinFailure()).toBe(2000);
  });

  it("caps at 60s across many consecutive failures", () => {
    const retry = createRetryState();
    for (let i = 0; i < 10; i++) retry.onJoinFailure();
    expect(retry.onJoinFailure()).toBe(60_000);
  });
});

describe("nextBackoff", () => {
  it("starts at the base delay and doubles each attempt", () => {
    expect(nextBackoff(0)).toBe(2000);
    expect(nextBackoff(1)).toBe(4000);
    expect(nextBackoff(2)).toBe(8000);
    expect(nextBackoff(3)).toBe(16_000);
  });

  it("caps at 60s for large attempt counts", () => {
    expect(nextBackoff(10)).toBe(60_000);
    expect(nextBackoff(100)).toBe(60_000);
  });
});

describe("throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls immediately on the leading edge", () => {
    const fn = vi.fn();
    const t = throttle(fn, 2000);
    t.call();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("coalesces calls within the window into one trailing call", () => {
    const fn = vi.fn();
    const t = throttle(fn, 2000);
    t.call(); // leading, t=0
    vi.advanceTimersByTime(500);
    t.call(); // within window, scheduled for t=2000
    t.call(); // still within window, no extra timer
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("allows an immediate call again once the window has fully elapsed", () => {
    const fn = vi.fn();
    const t = throttle(fn, 2000);
    t.call();
    vi.advanceTimersByTime(2000);
    t.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel prevents a pending trailing call", () => {
    const fn = vi.fn();
    const t = throttle(fn, 2000);
    t.call();
    t.call();
    t.cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
