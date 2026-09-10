import { expect, test } from "@playwright/test";
import { adminSessionCookie, mentorSessionCookie } from "./helpers/session";
import { upsertPerson } from "./helpers/db";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Absent members are active people with no open attendance session — a
// mentor/admin seeded here with no sessions is "absent" by definition, so no
// session seeding is needed to make them appear on the list.
const ABSENT_PERSON_ID = "00000000-0000-0000-0000-0000000ab501";
const ABSENT_PERSON_NAME = ["Absent", "E2E"];

async function seedAbsentPerson() {
  await upsertPerson(ABSENT_PERSON_ID, {
    firstName: ABSENT_PERSON_NAME[0],
    lastName: ABSENT_PERSON_NAME[1],
    role: "mentor",
    email: "e2e-absent-member@example.org",
    isActive: true,
  });
}

test("mentor sees the page read-only, with no Mark inactive buttons", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await mentorSessionCookie(BASE)]);
  const page = await context.newPage();

  await page.goto("/admin/absent-members", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Absent members" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mark inactive/i })).toHaveCount(0);

  await context.close();
});

test("guest is redirected away from the admin page", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/admin/absent-members", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/");

  await context.close();
});

test("admin can mark an absent member inactive from the list", async ({ browser }) => {
  await seedAbsentPerson();

  const context = await browser.newContext();
  await context.addCookies([await adminSessionCookie(BASE)]);
  const page = await context.newPage();

  await page.goto("/admin/absent-members", { waitUntil: "networkidle" });

  const row = page.locator("tr", { hasText: ABSENT_PERSON_NAME.join(" ") });
  await expect(row).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Mark inactive" }).click();

  // The list only shows is_active=true people, so the row disappearing IS the
  // proof the PUT landed — no separate DB read-back needed. Generous timeout:
  // the click triggers a PUT plus a full server-component router.refresh().
  await expect(row).toBeHidden({ timeout: 15000 });

  await context.close();
});
