import { expect, test } from "@playwright/test";
import { mentorSessionCookie } from "./helpers/session";
import { activePeriodId, deletePersonByName, upsertPerson } from "./helpers/db";

// Issue #328: the "Add someone who didn't sign up" picker has a name search so
// late adds don't require scrolling a long <select>.
const FIRST = "Zyxwvu";
const LAST = `Quillfeather${Date.now()}`;
const PERSON_ID = "00000000-0000-0000-0000-0000000e2e28";

test("mentor searches by name to late-add someone to an event", async ({ browser }) => {
  test.setTimeout(60_000);
  const periodId = await activePeriodId();
  await upsertPerson(PERSON_ID, {
    firstName: FIRST,
    lastName: LAST,
    role: "mentor",
    email: `zyxwvu-${Date.now()}@example.test`,
  });

  const ctx = await browser.newContext();
  await ctx.addCookies([await mentorSessionCookie()]);
  const api = ctx.request;
  const eventRes = await api.post("/api/admin/events", {
    data: {
      name: `E2E manual-add search ${Date.now()}`,
      periodId,
      startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000 + 2 * 3600 * 1000).toISOString(),
    },
  });
  expect(eventRes.status()).toBe(201);
  const { id: eventId } = (await eventRes.json()) as { id: string };

  try {
    const page = await ctx.newPage();
    await page.goto(`/admin/events/${eventId}`);
    const search = page.getByLabel("Search by name");
    const select = page.getByRole("combobox", { name: /Add someone who didn't sign up/ });
    const addBtn = page.getByRole("button", { name: "Add & check in" });

    // No match: select goes away, button disabled.
    await search.fill("no-such-person-qqq");
    await expect(page.getByText("No matches")).toBeVisible();
    await expect(addBtn).toBeDisabled();

    // Case-insensitive partial match narrows to exactly the seeded person.
    await search.fill(`  ${FIRST.slice(0, 5).toUpperCase()}  `);
    await expect(select.locator("option")).toHaveCount(1);
    await expect(select.locator("option")).toHaveText(`${FIRST} ${LAST}`);
    await expect(addBtn).toBeEnabled();

    await addBtn.click();
    await expect(page.locator("table tr", { hasText: `${FIRST} ${LAST}` }).getByText("Yes")).toBeVisible({ timeout: 15_000 });
  } finally {
    await api.delete(`/api/admin/events/${eventId}`).catch(() => {});
    await deletePersonByName(FIRST, LAST).catch(() => {});
    await ctx.close();
  }
});
