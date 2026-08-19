import { expect, test } from "@playwright/test";
import { adminSessionCookie, mentorSessionCookie, studentSessionCookie } from "./helpers/session";
import {
  badgeAwardExists,
  deleteBadgeByName,
  seededStudentPersonId,
} from "./helpers/db";

// An admin creates a badge, a mentor awards it to the seeded student, the
// student sees it on their own profile, and the mentor revokes it (issue #5's
// badges/training & credentials flow).
//
// Re-run-safe WITHOUT a db:reset between runs: badge names are unique, so
// before creating we delete any leftover badge with the same name from a
// prior run (cascades to its badge_award rows via FK).
const BADGE_NAME = "E2E Training Badge";

test("admin creates a badge, mentor awards it to the seeded student, student sees it, mentor revokes it", async ({
  browser,
}) => {
  await deleteBadgeByName(BADGE_NAME);
  const studentId = await seededStudentPersonId();

  // 1. Admin creates the badge definition.
  const adminContext = await browser.newContext();
  await adminContext.addCookies([await adminSessionCookie()]);
  const createRes = await adminContext.request.post("/api/admin/badges", {
    data: { name: BADGE_NAME, color: "#2563eb", allowSelfAward: false },
  });
  expect(createRes.status()).toBe(201);
  const { id: badgeId } = (await createRes.json()) as { id: string };
  expect(badgeId).toBeTruthy();
  await adminContext.close();

  // 2. A mentor awards it to the seeded student.
  const mentorContext = await browser.newContext();
  await mentorContext.addCookies([await mentorSessionCookie()]);
  const awardRes = await mentorContext.request.post(`/api/people/${studentId}/badges`, {
    data: { badgeId },
  });
  expect(awardRes.status()).toBe(201);
  expect(await badgeAwardExists(badgeId, studentId)).toBe(true);

  // 3. The mentor sees the badge on the student's profile page.
  const mentorPage = await mentorContext.newPage();
  await mentorPage.goto(`/people/${studentId}`);
  await expect(mentorPage.getByText(BADGE_NAME)).toBeVisible();
  await mentorContext.close();

  // 4. The student sees the badge on their own profile page.
  const studentContext = await browser.newContext();
  await studentContext.addCookies([await studentSessionCookie()]);
  const studentPage = await studentContext.newPage();
  await studentPage.goto(`/people/${studentId}`);
  await expect(studentPage.getByText(BADGE_NAME)).toBeVisible();
  await studentContext.close();

  // 5. A mentor revokes the award.
  const revokeContext = await browser.newContext();
  await revokeContext.addCookies([await mentorSessionCookie()]);
  const revokeRes = await revokeContext.request.delete(
    `/api/people/${studentId}/badges/${badgeId}`,
  );
  expect(revokeRes.ok()).toBe(true);
  await revokeContext.close();
  expect(await badgeAwardExists(badgeId, studentId)).toBe(false);
});

// A badge's `allowSelfAward` flag controls whether a student can award it to
// themself: false rejects the self-award with a 403, true allows it.
//
// Re-run-safe WITHOUT a db:reset between runs: badge names are unique, so
// before creating we delete any leftover badges with the same names from a
// prior run.
const NO_SELF_AWARD_BADGE_NAME = "E2E No Self-Award Badge";
const SELF_AWARD_BADGE_NAME = "E2E Self-Award Badge";

test("a non-self-awardable badge rejects a student's own self-award, but a self-awardable one succeeds", async ({
  browser,
}) => {
  await deleteBadgeByName(NO_SELF_AWARD_BADGE_NAME);
  await deleteBadgeByName(SELF_AWARD_BADGE_NAME);
  const studentId = await seededStudentPersonId();

  const adminContext = await browser.newContext();
  await adminContext.addCookies([await adminSessionCookie()]);

  const noSelfAwardRes = await adminContext.request.post("/api/admin/badges", {
    data: { name: NO_SELF_AWARD_BADGE_NAME, color: "#2563eb", allowSelfAward: false },
  });
  expect(noSelfAwardRes.status()).toBe(201);
  const { id: noSelfAwardBadgeId } = (await noSelfAwardRes.json()) as { id: string };

  const selfAwardRes = await adminContext.request.post("/api/admin/badges", {
    data: { name: SELF_AWARD_BADGE_NAME, color: "#2563eb", allowSelfAward: true },
  });
  expect(selfAwardRes.status()).toBe(201);
  const { id: selfAwardBadgeId } = (await selfAwardRes.json()) as { id: string };
  await adminContext.close();

  const studentContext = await browser.newContext();
  await studentContext.addCookies([await studentSessionCookie()]);

  const rejectedRes = await studentContext.request.post(`/api/people/${studentId}/badges`, {
    data: { badgeId: noSelfAwardBadgeId },
  });
  expect(rejectedRes.status()).toBe(403);

  const acceptedRes = await studentContext.request.post(`/api/people/${studentId}/badges`, {
    data: { badgeId: selfAwardBadgeId },
  });
  expect(acceptedRes.status()).toBe(201);
  expect(await badgeAwardExists(selfAwardBadgeId, studentId)).toBe(true);
  await studentContext.close();

  await deleteBadgeByName(NO_SELF_AWARD_BADGE_NAME);
  await deleteBadgeByName(SELF_AWARD_BADGE_NAME);
});
