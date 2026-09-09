import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { pushTestBlocked } from "./gate";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pushTestBlocked", () => {
  test("any Vercel deploy is blocked", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(pushTestBlocked()).toBe(true);
  });

  test("local dev (next dev) is allowed", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(pushTestBlocked()).toBe(false);
  });

  test("non-Vercel production build is blocked", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(pushTestBlocked()).toBe(true);
  });
});
