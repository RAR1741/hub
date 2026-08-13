import { expect, test } from "@playwright/test";
import { adminSessionCookie, mentorSessionCookie, studentSessionCookie } from "./helpers/session";

// Regression coverage for recent auth-gating features that previously only
// had throwaway/manual checks. Self-contained from a clean `db:reset`; no
// mutations, so also safe to re-run without one.

test.describe("teams hidden from guests", () => {
  test("anonymous GET /teams is redirected to /login", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/teams");
    expect(new URL(page.url()).pathname).toBe("/login");
    await context.close();
  });

  test("a signed-in student is NOT redirected away from /teams", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([await studentSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/teams");
    expect(new URL(page.url()).pathname).toBe("/teams");
    await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
    await context.close();
  });
});

test.describe("People edit icon is admin-only", () => {
  test("an admin sees a per-row edit link on /people", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([await adminSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/people");
    await expect(page.locator('a[aria-label^="Edit "]').first()).toBeVisible();
    await context.close();
  });

  test("a mentor does NOT see a per-row edit link on /people", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([await mentorSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.locator('a[aria-label^="Edit "]')).toHaveCount(0);
    await context.close();
  });
});

test.describe("admin hub is mentor-scoped", () => {
  // Cards gated to isAdmin on the hub (src/app/admin/page.tsx) — the ones a
  // mentor must NOT see. /admin/reports is deliberately excluded: it's
  // mentor-visible (Review section), not admin-only.
  const ADMIN_ONLY_HREFS = [
    "/admin/people",
    "/admin/teams",
    "/admin/meetings",
    "/admin/periods",
    "/admin/kiosk-devices",
    "/admin/settings",
  ];

  test("a mentor reaches /admin and sees Review + Time, but not Roster/Config", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([await mentorSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/admin");
    expect(new URL(page.url()).pathname).toBe("/admin");
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();

    // Mentor-visible cards.
    await expect(page.getByRole("link", { name: /Requests/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Flagged sessions/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reports/ })).toBeVisible();
    // The card's accessible name includes its count badge (e.g. "Sessions 3"),
    // so anchor on the start rather than an exact match; "Flagged sessions"
    // doesn't start with "Sessions" so this stays unambiguous.
    await expect(page.getByRole("link", { name: /^Sessions/ })).toBeVisible();

    // Admin-only cards must be absent for a mentor.
    for (const href of ADMIN_ONLY_HREFS) {
      await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);
    }
    await context.close();
  });

  test("an admin sees all admin-hub cards, including Roster and Config", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([await adminSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/admin");
    expect(new URL(page.url()).pathname).toBe("/admin");
    for (const href of ADMIN_ONLY_HREFS) {
      await expect(page.locator(`a[href="${href}"]`)).toHaveCount(1);
    }
    await context.close();
  });
});
