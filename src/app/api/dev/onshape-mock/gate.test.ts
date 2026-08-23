import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { onshapeMockBlocked } from "./gate";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("onshapeMockBlocked", () => {
  test("real Vercel prod is blocked even with the opt-in flag set", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_ONSHAPE_MOCK", "1");
    expect(onshapeMockBlocked()).toBe(true);
  });

  test("Vercel preview is blocked", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(onshapeMockBlocked()).toBe(true);
  });

  test("local dev (next dev) is allowed", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(onshapeMockBlocked()).toBe(false);
  });

  test("non-Vercel production-mode next start (CI e2e) is allowed with the opt-in flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_ONSHAPE_MOCK", "1");
    expect(onshapeMockBlocked()).toBe(false);
  });

  test("non-Vercel production-mode next start without the flag is blocked", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(onshapeMockBlocked()).toBe(true);
  });
});
