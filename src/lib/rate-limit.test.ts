import { describe, expect, test } from "vitest";
import { clientIp, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  test("allows up to limit within a window, then blocks", () => {
    const t = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  test("window reset restores allowance", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    t = 1001;
    expect(limiter.check("a")).toBe(true);
  });

  test("keys are independent", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
  });
});

describe("clientIp", () => {
  test("takes the first x-forwarded-for hop", () => {
    const req = new Request("http://test/", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });
  test("falls back to 'unknown'", () => {
    expect(clientIp(new Request("http://test/"))).toBe("unknown");
  });
  test("prefers the trusted real-IP header when present", () => {
    const req = new Request("http://test/", {
      headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(clientIp(req)).toBe("9.9.9.9");
  });
  test("falls back to the first x-forwarded-for hop", () => {
    const req = new Request("http://test/", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(clientIp(req)).toBe("1.1.1.1");
  });
  test("unknown when no headers", () => {
    expect(clientIp(new Request("http://test/"))).toBe("unknown");
  });
});
