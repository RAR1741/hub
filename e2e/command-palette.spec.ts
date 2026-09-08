import { expect, test } from "@playwright/test";
import { SEEDED_ADMIN_ID, mentorSessionCookie, studentSessionCookie } from "./helpers/session";

// ⌘K command palette (src/components/CommandPalette.tsx). cmdk renders items
// as [cmdk-item] divs (not <a href>), portaled to body — plain href
// assertions elsewhere can't see this, so this spec drives the dialog
// directly to prove palette-level gating and navigation.

test.describe("command palette — mentor", () => {
  test("keyboard shortcut opens it and Enter navigates to a page", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([await mentorSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/");

    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.locator("[cmdk-input]").fill("Tools");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/tools", { timeout: 15000 });

    await context.close();
  });

  test("click trigger opens it and a people search result navigates to their profile", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([await mentorSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/");

    await page.getByRole("button", { name: "Search" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // "Test Admin" (last_name "Admin") is a seeded person (supabase/seed.sql).
    // The search matches first_name/last_name individually (see listPeople in
    // src/lib/people.ts), so query on the last name alone — "Test Admin" as
    // one string matches neither field.
    await dialog.locator("[cmdk-input]").fill("Admin");
    const hit = dialog.locator("[cmdk-item]").filter({ hasText: "Test Admin" });
    await expect(hit).toBeVisible({ timeout: 5000 });
    await hit.click();
    await page.waitForURL(`**/people/${SEEDED_ADMIN_ID}`, { timeout: 15000 });

    await context.close();
  });

  test("does not show admin-only destinations", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([await mentorSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/");

    await page.getByRole("button", { name: "Search" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // "Settings" (/admin/settings) is admin-only (nav-destinations.ts gate:
    // "admin") — a mentor must see no matching item, proving palette-level
    // gating beyond what plain href assertions elsewhere can check.
    await dialog.locator("[cmdk-input]").fill("Settings");
    await expect(dialog.locator("[cmdk-item]")).toHaveCount(0);
    await expect(dialog.getByText("No results")).toBeVisible();

    await context.close();
  });
});

test.describe("command palette — student", () => {
  test("has no people search: placeholder and API both reflect the gate", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([await studentSessionCookie()]);
    const page = await context.newPage();
    await page.goto("/");

    await page.getByRole("button", { name: "Search" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[cmdk-input]")).toHaveAttribute(
      "placeholder",
      "Go to a page…",
    );

    const res = await page.request.get("/api/people/search?q=Test");
    expect(res.status()).toBe(403);

    await context.close();
  });
});

test.describe("command palette — guest", () => {
  test("people search API is forbidden without a session", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");

    const res = await page.request.get("/api/people/search?q=Test");
    expect(res.status()).toBe(403);

    await context.close();
  });
});
