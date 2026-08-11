import { expect, test } from "@playwright/test";

test("guest loads the home page and sees the nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Team Hub" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kiosk" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Leaderboard" })).toBeVisible();
});
