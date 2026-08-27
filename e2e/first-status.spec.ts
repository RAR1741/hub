import { expect, test } from "@playwright/test";
import { adminSessionCookie, mentorSessionCookie, SEEDED_MENTOR_ID } from "./helpers/session";
import { personFirstPeopleId, seedAppSetting, upsertPerson } from "./helpers/db";

// The FIRST roster sync feature never makes a live FIRST call in e2e — all
// status data (person columns + the last-sync report) is seeded directly via
// the DB, mirroring what a real sync would have written. See first-sync.ts
// for the FirstSyncReport shape and the admin `/admin/first-status` page for
// how it's rendered.
//
// Re-run-safe WITHOUT a db:reset between runs: person rows use pinned UUIDs
// (upsert on_conflict=id), and the app_setting report is reseeded at the top
// of each test rather than assumed.

// "AAA"/"ZZZ" prefixes keep these two names at the alphabetical extremes so
// the sort-order assertions hold regardless of whatever other active
// mentors/admins exist in the seed.
const MENTOR_A_ID = "00000000-0000-0000-0000-0000000f1a01";
const MENTOR_A_NAME = ["AAA-E2E", "Aardvark"];
const MENTOR_B_ID = "00000000-0000-0000-0000-0000000f1a02";
const MENTOR_B_NAME = ["ZZZ-E2E", "Zyzzyva"];
const LINK_TARGET_ID = "00000000-0000-0000-0000-0000000f1a03";
const LINK_TARGET_NAME = ["MMM-E2E", "Midfield"];

const UNMATCHED_PEOPLE_ID = 999;
const UNMATCHED_NAME = "Zed Zulu";
const UNMATCHED_EMAIL = "zed@example.org";

async function seedDashboardMentors() {
  await upsertPerson(MENTOR_A_ID, {
    firstName: MENTOR_A_NAME[0],
    lastName: MENTOR_A_NAME[1],
    role: "mentor",
    email: "e2e-first-a@example.org",
    firstPeopleId: 101,
    firstConsentRelease: true,
    firstScreeningStatus: "green",
    firstTrainingStatus: "blue",
  });
  await upsertPerson(MENTOR_B_ID, {
    firstName: MENTOR_B_NAME[0],
    lastName: MENTOR_B_NAME[1],
    role: "mentor",
    email: "e2e-first-b@example.org",
  });
}

test("admin dashboard shows mentor FIRST status, unmatched roster entries, and re-sorts by name", async ({
  browser,
}) => {
  await seedDashboardMentors();
  await seedAppSetting("first_last_sync_report", {
    ranAt: new Date().toISOString(),
    rosterCount: 1,
    matched: 1,
    updated: 1,
    unmatchedFirst: [{ peopleId: UNMATCHED_PEOPLE_ID, name: UNMATCHED_NAME, email: UNMATCHED_EMAIL }],
    unmatchedHub: [],
  });

  const context = await browser.newContext();
  await context.addCookies([await adminSessionCookie()]);
  const page = await context.newPage();

  // Warm the route — first hit triggers a ~5s Next compile in dev.
  await page.goto("/admin/first-status", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "FIRST roster status" })).toBeVisible();

  const mentorARow = page.locator("tr", { has: page.getByRole("link", { name: MENTOR_A_NAME.join(" ") }) });
  await expect(mentorARow.getByText("Signed", { exact: true })).toBeVisible();
  await expect(mentorARow.getByText("Action needed", { exact: true })).toBeVisible();

  await expect(page.getByText(UNMATCHED_NAME)).toBeVisible();
  await expect(page.getByText(UNMATCHED_EMAIL)).toBeVisible();

  const nameCells = page.locator("table.table tbody tr td:first-child a");
  const namesBefore = await nameCells.allTextContents();
  const aIndexBefore = namesBefore.indexOf(MENTOR_A_NAME.join(" "));
  const bIndexBefore = namesBefore.indexOf(MENTOR_B_NAME.join(" "));
  expect(aIndexBefore).toBeGreaterThanOrEqual(0);
  expect(bIndexBefore).toBeGreaterThanOrEqual(0);
  expect(aIndexBefore).toBeLessThan(bIndexBefore); // ascending: AAA... before ZZZ...

  await page.getByRole("button", { name: "Name" }).click();

  const namesAfter = await nameCells.allTextContents();
  const aIndexAfter = namesAfter.indexOf(MENTOR_A_NAME.join(" "));
  const bIndexAfter = namesAfter.indexOf(MENTOR_B_NAME.join(" "));
  expect(bIndexAfter).toBeLessThan(aIndexAfter); // descending: order flipped

  await context.close();
});

test("manual link removes the unmatched entry once a subsequent sync reflects it", async ({ browser }) => {
  await upsertPerson(LINK_TARGET_ID, {
    firstName: LINK_TARGET_NAME[0],
    lastName: LINK_TARGET_NAME[1],
    role: "mentor",
    email: "e2e-first-link-target@example.org",
    firstPeopleId: null,
  });
  await seedAppSetting("first_last_sync_report", {
    ranAt: new Date().toISOString(),
    rosterCount: 1,
    matched: 0,
    updated: 0,
    unmatchedFirst: [{ peopleId: UNMATCHED_PEOPLE_ID, name: UNMATCHED_NAME, email: UNMATCHED_EMAIL }],
    unmatchedHub: [],
  });

  const context = await browser.newContext();
  await context.addCookies([await adminSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/admin/first-status", { waitUntil: "networkidle" });

  const unmatchedCard = page.locator("div", { has: page.getByText(UNMATCHED_NAME, { exact: true }) }).first();
  await unmatchedCard.getByRole("combobox").selectOption({ label: LINK_TARGET_NAME.join(" ") });
  await unmatchedCard.getByRole("button", { name: "Link" }).click();
  await expect(unmatchedCard.getByRole("button", { name: "Link" })).toBeEnabled();

  // The link route only sets person.first_people_id — confirm that landed.
  await expect
    .poll(() => personFirstPeopleId(LINK_TARGET_ID))
    .toBe(UNMATCHED_PEOPLE_ID);

  // Simulate the *next* sync run (no live FIRST call in e2e): it would drop
  // the now-linked entry from unmatchedFirst and populate the person's
  // status columns from the roster.
  await upsertPerson(LINK_TARGET_ID, {
    firstName: LINK_TARGET_NAME[0],
    lastName: LINK_TARGET_NAME[1],
    role: "mentor",
    email: "e2e-first-link-target@example.org",
    firstPeopleId: UNMATCHED_PEOPLE_ID,
    firstConsentRelease: true,
    firstScreeningStatus: "green",
    firstTrainingStatus: "green",
  });
  await seedAppSetting("first_last_sync_report", {
    ranAt: new Date().toISOString(),
    rosterCount: 1,
    matched: 1,
    updated: 1,
    unmatchedFirst: [],
    unmatchedHub: [],
  });

  await page.goto("/admin/first-status", { waitUntil: "networkidle" });
  await expect(page.getByText(UNMATCHED_NAME)).toHaveCount(0);
  await expect(page.getByText("Everything on the FIRST roster is linked.")).toBeVisible();
  const linkedRow = page.locator("tr", {
    has: page.getByRole("link", { name: LINK_TARGET_NAME.join(" ") }),
  });
  await expect(linkedRow.getByText("Signed", { exact: true })).toBeVisible();

  await context.close();
});

test("authz: non-admin can't reach the dashboard, and the FIRST status card is scoped to self/admin", async ({
  browser,
}) => {
  await seedDashboardMentors();

  const mentorContext = await browser.newContext();
  await mentorContext.addCookies([await mentorSessionCookie()]);
  const mentorPage = await mentorContext.newPage();

  // A plain mentor is redirected away from the admin dashboard.
  await mentorPage.goto("/admin/first-status", { waitUntil: "networkidle" });
  expect(new URL(mentorPage.url()).pathname).toBe("/");

  // A mentor viewing ANOTHER mentor's page does not see the FIRST status card.
  await mentorPage.goto(`/people/${MENTOR_A_ID}`, { waitUntil: "networkidle" });
  await expect(mentorPage.getByRole("heading", { name: "FIRST status" })).toHaveCount(0);

  // A mentor viewing their OWN page does see it.
  await mentorPage.goto(`/people/${SEEDED_MENTOR_ID}`, { waitUntil: "networkidle" });
  await expect(mentorPage.getByRole("heading", { name: "FIRST status" })).toBeVisible();

  await mentorContext.close();
});
