import { expect, test } from "@playwright/test";
import { mentorSessionCookie, studentSessionCookie } from "./helpers/session";
import { activePeriodId } from "./helpers/db";

// Happy path for the generic form engine's first consumer (event sign-up
// forms, issue #181): a mentor builds a form + event, a student fills it out
// on the real /events UI, and the mentor sees the student's name and answers
// in the /admin/events/[id] responses table.
//
// Form/field/event creation goes through the admin APIs directly (issue's
// task-12 brief allows this for setup) — the builder UI is covered by its own
// spec/tests; what matters here end-to-end is the *rendered* member sign-up
// form and the *rendered* mentor roster. Those two steps drive the real UI.
const eventName = `E2E sign-up event ${Date.now()}`;

test("mentor builds a form, student submits it, mentor sees the response", async ({ browser }) => {
  // More setup (form + 2 fields + event via API) and two full page
  // navigations than most specs — give it headroom over the 30s default
  // when the local dev server is under load from the rest of the suite.
  test.setTimeout(60_000);
  const periodId = await activePeriodId();

  const mentorContext = await browser.newContext();
  await mentorContext.addCookies([await mentorSessionCookie()]);
  const mentorApi = mentorContext.request;

  // The attendance question and (via notesEnabled) the notes field are added
  // automatically by createForm — the mentor never creates them by hand.
  const formRes = await mentorApi.post("/api/admin/forms", {
    data: { title: `E2E sign-up form ${Date.now()}`, kind: "event_signup", status: "published", notesEnabled: true, notesLabel: "Notes" },
  });
  expect(formRes.status()).toBe(201);
  const { id: formId } = (await formRes.json()) as { id: string };

  const eventRes = await mentorApi.post("/api/admin/events", {
    data: {
      name: eventName,
      periodId,
      startsAt: "2026-09-25T18:00:00.000Z",
      endsAt: "2026-09-25T20:00:00.000Z",
      formId,
    },
  });
  expect(eventRes.status()).toBe(201);
  const { id: eventId } = (await eventRes.json()) as { id: string };

  try {
    // Student signs up through the real rendered form on /events.
    const studentContext = await browser.newContext();
    await studentContext.addCookies([await studentSessionCookie()]);
    const studentPage = await studentContext.newPage();
    await studentPage.goto("/events");
    // Exact-match the card by full event name — a broad substring match can
    // also catch other "E2E sign-up event ..." cards left over from a prior
    // (interrupted) run.
    const eventCard = studentPage.locator(".card").filter({ hasText: eventName });
    // Clicking "Sign up" opens a modal with the form; nothing is submitted
    // until "Submit" inside the modal is clicked.
    await eventCard.getByRole("button", { name: "Sign up" }).click();
    const dialog = studentPage.getByRole("dialog", { name: `Sign up for ${eventName}` });
    await dialog.getByRole("radio", { name: "Yes" }).check();
    await dialog.getByRole("textbox").fill("Bringing snacks!");
    await dialog.getByRole("button", { name: "Submit" }).click();
    // On success the modal closes and the card shows the signed-up state.
    // Generous timeout: this hits the RPC + a full-page re-render, which can
    // be slow on a loaded local dev server (rest of the e2e suite running
    // alongside this spec).
    await expect(eventCard.getByRole("button", { name: "Cancel sign-up" })).toBeVisible({ timeout: 15_000 });
    await studentContext.close();

    // Mentor sees the student's name and answers on the event admin page.
    const mentorPage = await mentorContext.newPage();
    await mentorPage.goto(`/admin/events/${eventId}`);
    await expect(mentorPage.getByRole("heading", { name: "Responses" })).toBeVisible();
    // Scope to the Responses table specifically — the roster table above it
    // also has a "Test Student" row (signed up, no answers), so a bare
    // page-wide "tr" locator matches both.
    const responsesTable = mentorPage.locator("table", { has: mentorPage.locator("th", { hasText: "Will you be attending?" }) });
    const responseRow = responsesTable.locator("tr", { hasText: "Test Student" });
    await expect(responseRow).toBeVisible();
    await expect(responseRow.getByText("Yes", { exact: true })).toBeVisible();
    await expect(responseRow.getByText("Bringing snacks!")).toBeVisible();
  } finally {
    await mentorApi.delete(`/api/admin/events/${eventId}`).catch(() => {});
    await mentorApi.delete(`/api/admin/forms/${formId}`).catch(() => {});
    await mentorContext.close();
  }
});
