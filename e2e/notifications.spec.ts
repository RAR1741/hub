import { test, expect } from "@playwright/test";
import { studentSessionCookie } from "./helpers/session";

test("guest is redirected from /me/notifications", async ({ page }) => {
  await page.goto("/me/notifications");
  await expect(page).toHaveURL(/\/login/);
});

test("a signed-in student sees meeting toggles and one persists", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await studentSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/me/notifications");

  const toggle = page.getByTestId("toggle-meeting_reminder");
  await expect(toggle).toBeVisible();
  const patched = page.waitForResponse((r) => r.url().includes("/api/notifications/prefs"));
  await toggle.check();
  await patched;
  await page.reload();
  await expect(page.getByTestId("toggle-meeting_reminder")).toBeChecked();

  // admin_alerts is admin-only — must not be offered to a student.
  await expect(page.getByTestId("toggle-admin_alerts")).toHaveCount(0);
});
