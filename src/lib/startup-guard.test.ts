import { describe, expect, test } from "vitest";
import { assertDevBypassFlagsSafe } from "./startup-guard";

describe("assertDevBypassFlagsSafe", () => {
  test("no env at all passes", () => {
    expect(() => assertDevBypassFlagsSafe({})).not.toThrow();
  });

  test("real DB + prod Vercel but no bypass flag passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        VERCEL_ENV: "production",
      }),
    ).not.toThrow();
  });

  test("flag on with local 127.0.0.1 DB passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });

  test("flag on, internal URL local, public URL local passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        SUPABASE_INTERNAL_URL: "http://host.docker.internal:54321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });

  test("flag on with localhost DB passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      }),
    ).not.toThrow();
  });

  test("flag on with bracketed IPv6 loopback DB passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://[::1]:54321",
      }),
    ).not.toThrow();
  });

  test("flag on, local DB, VERCEL_ENV=development passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        VERCEL_ENV: "development",
      }),
    ).not.toThrow();
  });

  test("flag on with non-local DB throws naming the flag and host", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      }),
    ).toThrow(/ALLOW_ONSHAPE_MOCK/);
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      }),
    ).toThrow(/abc\.supabase\.co/);
  });

  test("flag on, local DB, VERCEL_ENV=production throws naming VERCEL_ENV", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        VERCEL_ENV: "production",
      }),
    ).toThrow(/VERCEL_ENV/);
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        VERCEL_ENV: "production",
      }),
    ).toThrow(/production/);
  });

  test("flag on, local DB, VERCEL_ENV=preview throws", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        VERCEL_ENV: "preview",
      }),
    ).toThrow();
  });

  test("flag on, non-local DB, VERCEL_ENV=development throws (DB leg alone proves OR)", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        VERCEL_ENV: "development",
      }),
    ).toThrow();
  });

  test("flag on, DB unset passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
      }),
    ).not.toThrow();
  });

  test("flag on, unparseable DB URL throws fail-closed", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        NEXT_PUBLIC_SUPABASE_URL: "not a url",
      }),
    ).toThrow(/could not be parsed/);
  });

  test('flag value "true" (not "1") does not enable the guard', () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "true",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        VERCEL_ENV: "production",
      }),
    ).not.toThrow();
  });

  test("internal URL (local) wins over non-local public URL: passes", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        SUPABASE_INTERNAL_URL: "http://host.docker.internal:54321",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      }),
    ).not.toThrow();
  });

  test("internal URL (non-local) wins over local public URL: throws", () => {
    expect(() =>
      assertDevBypassFlagsSafe({
        ALLOW_ONSHAPE_MOCK: "1",
        SUPABASE_INTERNAL_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toThrow();
  });
});
