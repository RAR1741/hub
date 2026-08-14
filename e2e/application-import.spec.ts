import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { adminSessionCookie, studentSessionCookie } from "./helpers/session";
import { deletePersonByName } from "./helpers/db";

const CSV = readFileSync(join(__dirname, "fixtures", "application-sample.csv"), "utf8");

test("a non-admin is redirected away from /admin/application-import", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await studentSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/admin/application-import");
  expect(new URL(page.url()).pathname).not.toBe("/admin/application-import");
  await context.close();
});

test("an admin imports an application CSV and sees a result summary", async ({ browser }) => {
  // Re-run-safe: without this, a 2nd run finds the fixture applicant already
  // imported with an identical last_application_at and treats it as stale
  // rather than newly created.
  await deletePersonByName("Ada", "Testlake");
  const context = await browser.newContext();
  await context.addCookies([await adminSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/admin/application-import");
  await expect(page.getByRole("heading", { name: "Import applications" })).toBeVisible();

  // Paste the CSV via the file input using setInputFiles from a buffer.
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8"),
  });

  // Import must be blocked until a preview has been reviewed (never import directly).
  await expect(page.getByRole("button", { name: "Import" })).toBeDisabled();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "2. Preview" })).toBeVisible();

  // The fixture applicant is a brand-new synthetic person — no fuzzy match, so
  // Import enables right after preview (no decisions to make).
  await expect(page.getByRole("button", { name: "Import" })).toBeEnabled();
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "3. Result" })).toBeVisible();
  await expect(page.getByText("New people (review): Ada Testlake")).toBeVisible();
  await context.close();
});
