import { expect, test } from "@playwright/test";

test("styleguide renders every primitive in both themes", async ({ page }) => {
  await page.goto("/styleguide", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Primary" })).toBeVisible();
  await expect(page.locator(".avatar.role-admin")).toBeVisible();

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(page.getByRole("button", { name: "Primary" })).toBeVisible();
  await expect(page.locator(".avatar.role-admin")).toBeVisible();
});
