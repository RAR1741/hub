import { expect, test } from "@playwright/test";
import { mentorSessionCookie } from "./helpers/session";
import { activePeriodId, deletePersonByName, upsertPerson } from "./helpers/db";

// Issue #328: the "Add someone who didn't sign up" picker is a search-and-select combobox so
// late adds don't require scrolling a long list.
const FIRST = "Zyxwvu";
const LAST = `Quillfeather${Date.now()}`;
const PERSON_ID = "00000000-0000-0000-0000-0000000e2e28";

test("mentor searches by name to late-add someone to an event", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  await ctx.addCookies([await mentorSessionCookie()]);
  const api = ctx.request;
  let eventId: string | undefined;

  try {
    const periodId = await activePeriodId();
    await upsertPerson(PERSON_ID, {
      firstName: FIRST,
      lastName: LAST,
      role: "mentor",
      email: `zyxwvu-${Date.now()}@example.test`,
    });
    const eventRes = await api.post("/api/admin/events", {
      data: {
        name: `E2E manual-add search ${Date.now()}`,
        periodId,
        startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000 + 2 * 3600 * 1000).toISOString(),
      },
    });
    expect(eventRes.status()).toBe(201);
    eventId = ((await eventRes.json()) as { id: string }).id;

    const page = await ctx.newPage();
    await page.goto(`/admin/events/${eventId}`);
    // Wait for hydration so the controlled search input handles fill().
    await page.waitForLoadState("networkidle");
    const search = page.getByRole("combobox", { name: /Add someone who didn't sign up/ });
    const options = page.getByRole("listbox", { name: /Add someone/ }).getByRole("option");
    const addBtn = page.getByRole("button", { name: "Add & check in" });
    const fullName = `${FIRST} ${LAST}`;

    // Focus opens the list with everyone addable; nothing selected yet.
    await search.focus();
    await expect(search).toHaveAttribute("aria-expanded", "true");
    expect(await options.count()).toBeGreaterThan(0);
    await expect(options.filter({ hasText: fullName })).toHaveCount(1);
    await expect(addBtn).toBeDisabled();

    // No match: "No matches", button disabled.
    await search.fill("no-such-person-qqq");
    await expect(page.getByRole("status").getByText("No matches")).toBeVisible();
    await expect(addBtn).toBeDisabled();

    // Case-insensitive, padded partial match narrows to exactly the seeded person.
    await search.fill(`  ${FIRST.slice(0, 5).toUpperCase()}  `);
    await expect(options).toHaveCount(1);
    await expect(options).toHaveText(fullName);
    await expect(addBtn).toBeDisabled();

    // Enter with a single match selects it.
    await search.press("Enter");
    await expect(search).toHaveValue(fullName);
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(addBtn).toBeEnabled();

    // Editing the text clears the selection; clicking an option reselects.
    await search.fill(FIRST);
    await expect(addBtn).toBeDisabled();
    await options.filter({ hasText: fullName }).click();
    await expect(search).toHaveValue(fullName);
    await expect(addBtn).toBeEnabled();

    await addBtn.click();
    await expect(page.locator("table tr", { hasText: fullName }).getByText("Yes")).toBeVisible({ timeout: 15_000 });
    await expect(search).toHaveValue("");
    await expect(addBtn).toBeDisabled();
  } finally {
    // Person first: session.person_id cascades, and session.event_id is
    // ON DELETE RESTRICT so the event can't be deleted while the check-in exists.
    await deletePersonByName(FIRST, LAST).catch(() => {});
    if (eventId) {
      const del = await api.delete(`/api/admin/events/${eventId}`);
      expect(del.ok()).toBe(true);
    }
    await ctx.close();
  }
});
