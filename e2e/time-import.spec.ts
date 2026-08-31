import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { adminSessionCookie, studentSessionCookie } from "./helpers/session";

const CSV = readFileSync(join(__dirname, "fixtures", "time-sheet-sample.csv"), "utf8");

test("a non-admin is redirected away from /admin/time-import", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await studentSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/admin/time-import");
  expect(new URL(page.url()).pathname).not.toBe("/admin/time-import");
  await context.close();
});

test("an admin imports a time-sheet CSV and sees a result summary", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await adminSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/admin/time-import");
  await expect(page.getByRole("heading", { name: "Import time sheet" })).toBeVisible();

  // Paste the CSV via the file input using setInputFiles from a buffer.
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8"),
  });

  // Import must be blocked until a preview has been reviewed (never import directly).
  await expect(page.getByRole("button", { name: "Import" })).toBeDisabled();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "2. Preview" })).toBeVisible();

  // The fixture has one AM/PM-ambiguous clock-in — Import stays disabled until
  // a reading is chosen. Picking AM satisfies the gate.
  await expect(page.getByRole("button", { name: "Import" })).toBeDisabled();
  await page.getByRole("button", { name: /^AM/ }).first().click();

  // With every anomaly decided, Import enables; run it and see the result summary.
  await expect(page.getByRole("button", { name: "Import" })).toBeEnabled();
  await page.getByRole("button", { name: "Import" }).click();
  const resultHeading = page.getByRole("heading", { name: "3. Result" });
  await expect(resultHeading).toBeVisible();
  // Scope to the Result section — a page-wide text search also matches the
  // sidebar's hidden "Flagged sessions" nav flyout link, which is present in
  // the DOM (just hidden via CSS until hover) since the Mission Control nav.
  const resultSection = page.locator("section").filter({ has: resultHeading });
  await expect(resultSection.getByText(/sessions/).first()).toBeVisible();
  await context.close();
});
