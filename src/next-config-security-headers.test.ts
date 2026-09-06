import { describe, expect, test } from "vitest";
import nextConfig from "../next.config";

// Guards the site-wide security headers (security audit #251) against
// accidental removal, and confirms the /onshape framing exception is intact.
describe("next.config security headers", () => {
  test("baseline security headers are applied site-wide", async () => {
    const rules = await nextConfig.headers!();
    const global = rules.find((r) => r.source === "/:path*");
    expect(global, "expected a /:path* header rule").toBeTruthy();

    const byKey = Object.fromEntries(global!.headers.map((h) => [h.key, h.value]));
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(byKey["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
  });

  test("the /onshape frame-ancestors exception is preserved", async () => {
    const rules = await nextConfig.headers!();
    for (const source of ["/onshape", "/onshape/:path*"]) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, `expected a ${source} header rule`).toBeTruthy();
      const csp = rule!.headers.find((h) => h.key === "Content-Security-Policy");
      expect(csp?.value).toContain("frame-ancestors 'self' https://*.onshape.com");
    }
  });
});
