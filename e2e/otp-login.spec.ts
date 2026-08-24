import { expect, test, type Page } from "@playwright/test";
import { hashOtpCode } from "../src/lib/otp";
import { deleteLoginOtpRows, seedLoginOtpCode, seedOtpPerson } from "./helpers/db";

const CODE = "12345678";

/**
 * Submits the email through the real UI (so we land on the code phase), then
 * swaps whatever login_otp row the request route created for one with a
 * KNOWN code. The request route deletes prior unconsumed rows for the person
 * before inserting its own (see src/app/api/auth/otp/request/route.ts), so
 * seeding has to happen *after* the UI step, and verify picks the newest row
 * by created_at — deleting the route's row first keeps ours unambiguous.
 */
async function requestCodeThenSeedKnown(page: Page, email: string, personId: string) {
  const emailSection = page.locator("section:has(h2:text('Email'))");
  await emailSection.getByLabel(/^email$/i).fill(email);
  await emailSection.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(`A one-time code has been sent to ${email}.`)).toBeVisible();

  await deleteLoginOtpRows(personId);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await seedLoginOtpCode(personId, hashOtpCode(CODE), expiresAt);
}

test("a user signs in with an emailed one-time code", async ({ page }) => {
  const email = `otp-${Date.now()}@example.com`;
  const personId = await seedOtpPerson(email);

  await page.goto("/login");
  await requestCodeThenSeedKnown(page, email, personId);

  for (let i = 0; i < CODE.length; i++) {
    await page.getByLabel(`Code digit ${i + 1}`).fill(CODE[i]);
  }

  await page.waitForURL("**/");
  await expect(page.getByText(/signed in as/i)).toBeVisible();
});

test("pasting a full code into a digit box auto-submits", async ({ page }) => {
  const email = `otp-paste-${Date.now()}@example.com`;
  const personId = await seedOtpPerson(email);

  await page.goto("/login");
  await requestCodeThenSeedKnown(page, email, personId);

  const firstBox = page.getByLabel("Code digit 1");
  await firstBox.click();
  await firstBox.evaluate((el, pastedCode) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text", pastedCode);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  }, CODE);

  await page.waitForURL("**/");
  await expect(page.getByText(/signed in as/i)).toBeVisible();
});

test("an incorrect code shows an error and clears the boxes", async ({ page }) => {
  const email = `otp-wrong-${Date.now()}@example.com`;
  const personId = await seedOtpPerson(email);

  await page.goto("/login");
  await requestCodeThenSeedKnown(page, email, personId);

  const wrongCode = "99999999";
  for (let i = 0; i < wrongCode.length; i++) {
    await page.getByLabel(`Code digit ${i + 1}`).fill(wrongCode[i]);
  }

  await expect(page.getByText(/that code didn't work/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Code digit 1")).toHaveValue("");
});
