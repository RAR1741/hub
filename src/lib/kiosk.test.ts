import { describe, expect, test } from "vitest";
import { generateKioskToken, hashKioskToken } from "./kiosk";

describe("hashKioskToken", () => {
  test("is deterministic sha256 hex (64 chars)", () => {
    const h = hashKioskToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKioskToken("abc")).toBe(h);
    expect(hashKioskToken("abd")).not.toBe(h);
  });
});

describe("generateKioskToken", () => {
  test("produces distinct, url-safe tokens", () => {
    const a = generateKioskToken();
    const b = generateKioskToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
