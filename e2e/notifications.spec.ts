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

test("meeting reminder lead time persists after reload", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await studentSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/me/notifications");

  const toggle = page.getByTestId("toggle-meeting_reminder");
  await expect(toggle).toBeVisible();
  if (!(await toggle.isChecked())) {
    const enabled = page.waitForResponse((r) => r.url().includes("/api/notifications/prefs"));
    await toggle.check();
    await enabled;
  }

  const lead15 = page.getByTestId("lead-15");
  await expect(lead15).toBeVisible();
  const patched = page.waitForResponse((r) => r.url().includes("/api/notifications/prefs"));
  await lead15.check();
  await patched;

  await page.reload();
  await expect(page.getByTestId("toggle-meeting_reminder")).toBeChecked();
  await expect(page.getByTestId("lead-15")).toBeChecked();
});
