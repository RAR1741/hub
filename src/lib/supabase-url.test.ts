import { describe, expect, test } from "vitest";
import { resolveServerSupabaseUrl } from "./supabase-url";

describe("resolveServerSupabaseUrl", () => {
  test("prefers the internal URL when set (dev container → sibling containers)", () => {
    expect(
      resolveServerSupabaseUrl({
        SUPABASE_INTERNAL_URL: "http://host.docker.internal:54321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toBe("http://host.docker.internal:54321");
  });

  test("falls back to the public URL in production", () => {
    expect(
      resolveServerSupabaseUrl({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      }),
    ).toBe("https://abc.supabase.co");
  });

  test("throws when neither is configured", () => {
    expect(() => resolveServerSupabaseUrl({})).toThrow();
  });
});
