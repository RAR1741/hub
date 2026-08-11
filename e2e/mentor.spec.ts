import { expect, test } from "@playwright/test";
import { mentorSessionCookie } from "./helpers/session";
import { seededStudentPersonId } from "./helpers/db";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await mentorSessionCookie(BASE)]);
});

test("mentor can load /calendar (mentor+ gate passes)", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: /Calendar/ })).toBeVisible();
});

test("mentor can load the flagged-sessions screen", async ({ page }) => {
  await page.goto("/admin/sessions/flagged");
  await expect(page.getByRole("heading", { name: /Flagged sessions/ })).toBeVisible();
});

test("mentor create-manual-session API accepts a valid payload", async ({ page }) => {
  // Uses the browser context's mentor cookie; needs the seeded student id.
  const personId = await seededStudentPersonId();
  const res = await page.request.post("/api/admin/sessions", {
    data: {
      personId,
      timeIn: "2026-09-01T18:00:00Z",
      timeOut: "2026-09-01T20:00:00Z",
      note: "e2e manual",
    },
  });
  expect(res.status()).toBe(200);
});
