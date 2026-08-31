import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { styleguideBlocked } from "./gate";

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("styleguideBlocked", () => {
  test("Vercel production is blocked", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(styleguideBlocked()).toBe(true);
  });
  test("Vercel preview is blocked", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(styleguideBlocked()).toBe(true);
  });
  test("local dev is allowed", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(styleguideBlocked()).toBe(false);
  });
  test("non-Vercel next start (CI e2e) is allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(styleguideBlocked()).toBe(false);
  });
});
