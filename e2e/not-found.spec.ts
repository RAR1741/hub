import { expect, test } from "@playwright/test";

// Asserts the noindex marker rather than a 404 status: once a root loading.tsx
// wraps every segment in Suspense (#300), a 404 streams as 200 with
// <meta name="robots" content="noindex"> injected instead of setting the status.
test("unmatched URL renders the branded 404 inside the app chrome", async ({ page }) => {
  const response = await page.goto("/no-such-route-here");

  expect(await response?.text()).toContain('<meta name="robots" content="noindex"');
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the hub" })).toBeVisible();
  // Our not-found.tsx renders inside the root layout, so the nav survives.
  await expect(page.getByRole("link", { name: "Leaderboard" })).toBeVisible();
});
