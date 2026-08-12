import { describe, expect, test } from "vitest";
import { clientUrl } from "./request-origin";

function req(url: string, headers: Record<string, string>): Request {
  return new Request(url, { headers });
}

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
});
