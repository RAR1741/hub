import { expect, test } from "@playwright/test";
import { adminSessionCookie } from "./helpers/session";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await adminSessionCookie()]);
});

test("admin can add a team external account, see it listed, then remove it", async ({ page }) => {
  const name = `E2E External Team ${Date.now()}`;

  const createRes = await page.request.post("/api/admin/teams", {
    data: { name, joinMode: "admin_only" },
  });
  expect(createRes.status()).toBe(201);
  const { id } = (await createRes.json()) as { id: string };
  expect(id).toBeTruthy();

  try {
    await page.goto(`/admin/teams/${id}`);
    const section = page.locator("section", { hasText: "External accounts" });
    await section.getByLabel("Label").fill("Test bot");
    await section.getByLabel("Provider").selectOption("google");
    await section.getByLabel("Identifier").fill("testbot@example.com");
    await section.getByRole("button", { name: "Add" }).click();

    await expect(section.getByText("testbot@example.com")).toBeVisible();

    await section.getByRole("button", { name: "Remove" }).click();
    await expect(section.getByText("testbot@example.com")).not.toBeVisible();
  } finally {
    await page.request.delete(`/api/admin/teams/${id}`).catch(() => {});
  }
});
