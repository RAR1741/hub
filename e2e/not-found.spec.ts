import { expect, test } from "@playwright/test";

// A URL that matches no route at all — this stays a real 404 regardless of any
// loading.tsx boundary (notFound() from inside a page can stream a 200 instead).
test("unmatched URL renders the branded 404 inside the app chrome", async ({ page }) => {
  const response = await page.goto("/no-such-route-here");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the hub" })).toBeVisible();
  // Our not-found.tsx renders inside the root layout, so the nav survives.
  await expect(page.getByRole("link", { name: "Leaderboard" })).toBeVisible();
});
