import { describe, expect, test } from "vitest";
import { AUTH_COOKIE_NAME } from "./supabase-cookie";

// Regression guard for the OAuth PKCE bug: supabase-js derives its default auth
// cookie name from the Supabase URL hostname, and our browser/server clients use
// different URLs (127.0.0.1 vs host.docker.internal). Every Supabase auth client
// must pin THIS shared, URL-independent name via cookieOptions.name, or the PKCE
// verifier the browser writes can't be read by the server callback.
describe("AUTH_COOKIE_NAME", () => {
  test("is a fixed, non-empty value not derived from a URL hostname", () => {
    expect(AUTH_COOKIE_NAME).toBe("sb-teamhub-auth-token");
    expect(AUTH_COOKIE_NAME).not.toMatch(/127|host\.docker|localhost/);
  });
});
