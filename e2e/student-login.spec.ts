import { expect, test } from "@playwright/test";
import { SEEDED_STUDENT_ID_NUMBER } from "./helpers/session";

test("a student signs in with their ID number", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/student id/i).fill(SEEDED_STUDENT_ID_NUMBER);
  await page.locator("form", { has: page.getByLabel(/student id/i) }).getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/");
  await expect(page.getByText(/signed in as/i)).toBeVisible();
});
