import { expect, test } from "@playwright/test";
import { mentorSessionCookie, studentSessionCookie } from "./helpers/session";
import {
  excusalExists,
  findPendingExcusalRequestId,
  seededStudentPersonId,
} from "./helpers/db";

// A student requests an excusal, a mentor approves it, and the approval
// creates a real `excusal` row (M6 issue #28's self-service request flow).
// Self-contained from a clean `db:reset`: uses a fixed date that no other
// spec touches for this person.
const REQUEST_DATE = "2026-09-20";

test("student excusal request -> mentor approval creates an excusal", async ({ browser }) => {
  const personId = await seededStudentPersonId();

  // 1. Student POSTs their own excusal request.
  const studentContext = await browser.newContext();
  await studentContext.addCookies([await studentSessionCookie()]);
  const studentApi = studentContext.request;
  const createRes = await studentApi.post("/api/excusal-requests", {
    data: { date: REQUEST_DATE, reason: "e2e: family event" },
  });
  expect(createRes.status()).toBe(201);
  await studentContext.close();

  // No excusal exists yet — only a pending request.
  expect(await excusalExists(personId, REQUEST_DATE)).toBe(false);

  const requestId = await findPendingExcusalRequestId(personId, REQUEST_DATE);
  expect(requestId).not.toBeNull();

  // 2. A mentor sees it in the Requests queue and approves it.
  const mentorContext = await browser.newContext();
  await mentorContext.addCookies([await mentorSessionCookie()]);
  const mentorPage = await mentorContext.newPage();
  await mentorPage.goto("/admin/requests");
  await expect(mentorPage.getByRole("heading", { name: "Requests", exact: true })).toBeVisible();
  await expect(mentorPage.getByText(REQUEST_DATE)).toBeVisible();

  const reviewRes = await mentorContext.request.post(
    `/api/admin/requests/excusal/${requestId}`,
    { data: { action: "approve" } },
  );
  expect(reviewRes.ok()).toBe(true);
  await mentorContext.close();

  // 3. Approving created a real excusal row for that person+date.
  expect(await excusalExists(personId, REQUEST_DATE)).toBe(true);
});

test("mentor Requests nav link is visible to mentors", async ({ browser }) => {
  const mentorContext = await browser.newContext();
  await mentorContext.addCookies([await mentorSessionCookie()]);
  const page = await mentorContext.newPage();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Requests" })).toBeVisible();
  await mentorContext.close();
});
