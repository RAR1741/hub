import { expect, test } from "@playwright/test";
import { adminSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await adminSessionCookie(BASE)]);
});

test("admin can create a manual meeting via the API, see it on the admin page, then delete it", async ({
  page,
}) => {
  const title = `E2E manual meeting ${Date.now()}`;

  const createRes = await page.request.post("/api/admin/meetings", {
    data: {
      title,
      startsAt: "2026-09-15T18:00:00.000Z",
      endsAt: "2026-09-15T20:00:00.000Z",
    },
  });
  expect(createRes.status()).toBe(201);
  const { id } = (await createRes.json()) as { id: string };
  expect(id).toBeTruthy();

  try {
    await page.goto("/admin/meetings");
    await expect(page.getByText(title)).toBeVisible();
    // Manual meetings (gcal_event_id = null) are labeled distinctly from
    // Google-synced ones on this row.
    const row = page.locator("tr", { hasText: title });
    await expect(row.locator(".pill")).toHaveText("Manual");

    const deleteRes = await page.request.delete(`/api/admin/meetings/${id}`);
    expect(deleteRes.status()).toBe(200);

    await page.goto("/admin/meetings");
    await expect(page.getByText(title)).not.toBeVisible();
  } finally {
    // Best-effort cleanup in case an assertion above threw before the delete ran.
    await page.request.delete(`/api/admin/meetings/${id}`).catch(() => {});
  }
});
