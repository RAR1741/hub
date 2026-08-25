import { expect, test } from "@playwright/test";
import { studentSessionCookie } from "./helpers/session";
import { deleteBuildDay, deleteExcusalRequests, seedBuildDay, seededStudentPersonId } from "./helpers/db";

// The per-missed-day "Request excusal" link on /me/attendance was replaced by
// a modal (MissedDaysExcusal). This exercises the exact regression a reviewer
// flagged: after a successful request, the row must swap to a disabled
// "Pending excusal" pill, not stay clickable.
//
// Self-contained + re-run-safe: BUILD_DAY_DATE is a synthetic required build
// day (no other spec's fixture date) seeded here via a manual build_day
// upsert, so the student has no session/excusal for it and it always renders
// as a missed required day. Cleaned up before AND after in case a prior run
// was interrupted.
const BUILD_DAY_DATE = "2026-07-15";

test("student requests excusal from the missed-day modal and the row shows Pending excusal", async ({
  browser,
}) => {
  const personId = await seededStudentPersonId();
  await deleteExcusalRequests(personId, BUILD_DAY_DATE);
  await seedBuildDay(BUILD_DAY_DATE, "required");

  const context = await browser.newContext();
  await context.addCookies([await studentSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/me/attendance");

  const row = page.locator("li").filter({ hasText: BUILD_DAY_DATE });
  await row.getByRole("button", { name: "Request excusal" }).click();

  const dialog = page.getByRole("dialog", { name: "Request excusal" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Reason (optional)").fill("e2e: family event");
  await dialog.getByRole("button", { name: "Request excusal" }).click();

  // Modal closes and the page refreshes with the new pending request.
  await expect(dialog).not.toBeVisible();
  await expect(row.getByText("Pending excusal")).toBeVisible();
  await expect(row.getByRole("button", { name: "Request excusal" })).toHaveCount(0);

  await context.close();
  await deleteExcusalRequests(personId, BUILD_DAY_DATE);
  await deleteBuildDay(BUILD_DAY_DATE);
});
