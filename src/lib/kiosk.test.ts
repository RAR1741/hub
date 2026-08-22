import { describe, expect, test } from "vitest";
import {
  KIOSK_COOKIE,
  generateKioskToken,
  hashKioskToken,
  kioskActionAllowed,
  renameKioskDevice,
} from "./kiosk";

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

describe("renameKioskDevice", () => {
  function fakeDb(found: boolean) {
    return {
      from: () => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: found ? { id: "k1" } : null, error: null }),
            }),
          }),
        }),
      }),
    } as never;
  }

  test("404 when missing", async () => {
    expect(await renameKioskDevice("k1", "Front Desk", fakeDb(false))).toEqual({
      ok: false, status: 404,
    });
  });

  test("ok when renamed", async () => {
    expect(await renameKioskDevice("k1", "Front Desk", fakeDb(true))).toEqual({
      ok: true, status: 200,
    });
  });
});

describe("kioskActionAllowed", () => {
  function fakeDb(validToken: boolean) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: validToken ? { id: "k1" } : null, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      }),
    } as never;
  }

  function requestWithToken(token?: string) {
    return new Request("http://kiosk.local/api/kiosk/clock-in", {
      headers: token ? { cookie: `${KIOSK_COOKIE}=${token}` } : {},
    });
  }

  test("valid kiosk token allows action regardless of role", async () => {
    const request = requestWithToken("tok");
    expect(await kioskActionAllowed(request, { role: "guest", db: fakeDb(true) })).toBe(true);
  });

  test("invalid token + admin role allows action", async () => {
    const request = requestWithToken("tok");
    expect(await kioskActionAllowed(request, { role: "admin", db: fakeDb(false) })).toBe(true);
  });

  test("invalid token + mentor role denies action", async () => {
    const request = requestWithToken("tok");
    expect(await kioskActionAllowed(request, { role: "mentor", db: fakeDb(false) })).toBe(false);
  });

  test("invalid token + guest role denies action", async () => {
    const request = requestWithToken();
    expect(await kioskActionAllowed(request, { role: "guest", db: fakeDb(false) })).toBe(false);
  });
});
