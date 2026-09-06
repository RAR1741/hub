import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clientUrl } from "./request-origin";

function req(url: string, headers: Record<string, string>): Request {
  return new Request(url, { headers });
}

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("clientUrl", () => {
  test("uses the Host header, not request.url's bind host (the 0.0.0.0 dev bug)", () => {
    // next dev -H 0.0.0.0 makes request.url carry 0.0.0.0 even though the
    // browser sent Host: localhost:3000.
    const r = req("http://0.0.0.0:3000/api/auth/logout", { host: "localhost:3000" });
    expect(clientUrl(r, "/").toString()).toBe("http://localhost:3000/");
  });

  test("preserves the path and query", () => {
    const r = req("http://0.0.0.0:3000/auth/callback?code=abc", { host: "localhost:3000" });
    expect(clientUrl(r, "/login?error=oauth").toString()).toBe(
      "http://localhost:3000/login?error=oauth",
    );
  });

  test("honors x-forwarded-host and x-forwarded-proto (behind a proxy like Vercel)", () => {
    const r = req("http://internal-host/auth/callback", {
      host: "internal-host",
      "x-forwarded-host": "hub.redalert1741.org",
      "x-forwarded-proto": "https",
    });
    expect(clientUrl(r, "/").toString()).toBe("https://hub.redalert1741.org/");
  });

  test("falls back to request.url when no host header is present", () => {
    const r = req("https://example.test/x", {});
    expect(clientUrl(r, "/").toString()).toBe("https://example.test/");
  });

  describe("with APP_ALLOWED_HOSTS configured", () => {
    test("uses an allow-listed forwarded host", () => {
      vi.stubEnv("APP_ALLOWED_HOSTS", "hub.redalert1741.org");
      const r = req("http://internal/x", {
        host: "internal",
        "x-forwarded-host": "hub.redalert1741.org",
        "x-forwarded-proto": "https",
      });
      expect(clientUrl(r, "/login").toString()).toBe("https://hub.redalert1741.org/login");
    });

    test("pins a spoofed host to the canonical (first allow-listed) host", () => {
      vi.stubEnv("APP_ALLOWED_HOSTS", "hub.redalert1741.org, hub2.redalert1741.org");
      const r = req("https://hub.redalert1741.org/auth/callback", {
        host: "hub.redalert1741.org",
        "x-forwarded-host": "evil.example.com",
        "x-forwarded-proto": "https",
      });
      // The attacker-controlled x-forwarded-host must NOT be used.
      expect(clientUrl(r, "/login?error=oauth").toString()).toBe(
        "https://hub.redalert1741.org/login?error=oauth",
      );
    });

    test("still accepts localhost even when an allow-list is configured", () => {
      vi.stubEnv("APP_ALLOWED_HOSTS", "hub.redalert1741.org");
      const r = req("http://0.0.0.0:3000/x", { host: "localhost:3000" });
      expect(clientUrl(r, "/").toString()).toBe("http://localhost:3000/");
    });

    test("drops a caller-chosen port when only the hostname is allow-listed", () => {
      vi.stubEnv("APP_ALLOWED_HOSTS", "hub.redalert1741.org");
      const r = req("https://hub.redalert1741.org/x", {
        host: "hub.redalert1741.org",
        "x-forwarded-host": "hub.redalert1741.org:444",
        "x-forwarded-proto": "https",
      });
      // The allow-list owns the authority: the injected :444 must not survive.
      expect(clientUrl(r, "/").toString()).toBe("https://hub.redalert1741.org/");
    });

    test("does not fall for userinfo (@) injection that resolves to another host", () => {
      vi.stubEnv("APP_ALLOWED_HOSTS", "hub.redalert1741.org");
      // Authority would resolve to evil.example.com via new URL(); the allow-list
      // check must reject the malformed host and pin to the canonical host.
      const r = req("https://hub.redalert1741.org/auth/callback", {
        host: "hub.redalert1741.org",
        "x-forwarded-host": "hub.redalert1741.org:443@evil.example.com",
        "x-forwarded-proto": "https",
      });
      const out = clientUrl(r, "/login").toString();
      expect(out).toBe("https://hub.redalert1741.org/login");
      expect(out).not.toContain("evil.example.com");
    });

    test("uses only the first entry of a comma-separated x-forwarded-host, and pins if it's not allow-listed", () => {
      vi.stubEnv("APP_ALLOWED_HOSTS", "hub.redalert1741.org");
      const r = req("https://hub.redalert1741.org/x", {
        host: "hub.redalert1741.org",
        "x-forwarded-host": "evil.example.com, hub.redalert1741.org",
        "x-forwarded-proto": "https",
      });
      expect(clientUrl(r, "/").toString()).toBe("https://hub.redalert1741.org/");
    });
  });

  test("uses the first token of a comma-separated x-forwarded-proto (no throw)", () => {
    const r = req("http://internal/x", {
      host: "hub.redalert1741.org",
      "x-forwarded-host": "hub.redalert1741.org",
      "x-forwarded-proto": "https, http",
    });
    expect(clientUrl(r, "/").toString()).toBe("https://hub.redalert1741.org/");
  });

  test("falls back to request.url's scheme for a non-http(s) x-forwarded-proto", () => {
    const r = req("https://hub.redalert1741.org/x", {
      host: "hub.redalert1741.org",
      "x-forwarded-host": "hub.redalert1741.org",
      "x-forwarded-proto": "javascript",
    });
    expect(clientUrl(r, "/").toString()).toBe("https://hub.redalert1741.org/");
  });

  test("rejects a malformed (@) host even with no allow-list, falling back to request.url", () => {
    // No APP_ALLOWED_HOSTS: a bare `new URL()` on this would resolve to evil.com,
    // so the malformed host must be dropped rather than trusted.
    const r = req("https://real.example/x", {
      "x-forwarded-host": "real.example:443@evil.example.com",
    });
    const out = clientUrl(r, "/").toString();
    expect(out).toBe("https://real.example/");
    expect(out).not.toContain("evil.example.com");
  });
});
