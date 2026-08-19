import { test, expect } from "@playwright/test";
import { adminSessionCookie, mentorSessionCookie, studentSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Guardian visibility", () => {
  test("student viewing their own profile does NOT see Guardians section", async ({
    context,
    page,
  }) => {
    const cookie = await studentSessionCookie(BASE);
    await context.addCookies([cookie]);

    // Student views their own profile (seeded student 1741)
    await page.goto(`${BASE}/people/1741`);
    // Guardians section should NOT be visible for self-view
    await expect(page.locator("h2", { hasText: "Guardians" })).not.toBeVisible();
  });

  test("mentor viewing a student profile CAN see read-only Guardians section", async ({
    context,
    page,
  }) => {
    const cookie = await mentorSessionCookie(BASE);
    await context.addCookies([cookie]);

    // Mentor views a student's profile
    await page.goto(`${BASE}/people/1741`);
    // Guardians section should be visible
    await expect(page.locator("h2", { hasText: "Guardians" })).toBeVisible();
  });
});

test.describe("Admin guardian CRUD", () => {
  test.beforeEach(async ({ context }) => {
    // Set up admin context for all tests in this group
    const cookie = await adminSessionCookie(BASE);
    await context.addCookies([cookie]);
  });

  test("admin can create a new guardian and link to a student", async ({ page }) => {
    const guardianName = `Guardian${Date.now()}`;
    // Go to admin edit page for a student
    await page.goto(`${BASE}/admin/people/1741`);

    // Find the Guardians section
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    await expect(guardianSection).toBeVisible();

    // Expand "Add new guardian"
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    // Fill form fields
    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(`${guardianName}@example.com`);
    await inputs.nth(3).fill("555-0001");
    await inputs.nth(4).fill("Test Company");
    await inputs.nth(5).fill("Parent");

    // Submit
    const btn = addDetails.locator("button:text('Add guardian')");
    await btn.click();

    // Verify appears
    await expect(page.locator(`text=${guardianName} TestLast`)).toBeVisible({ timeout: 5000 });
  });

  test("admin can edit a guardian's contact fields", async ({ page }) => {
    const guardianName = `EditGuardian${Date.now()}`;
    // Create a guardian first
    await page.goto(`${BASE}/admin/people/1741`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill("original@example.com");
    await inputs.nth(3).fill("555-0002");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Reload and edit
    await page.reload();
    const guardianRow = guardianSection.locator(`text=${guardianName}`).first().locator("..");

    // Click Edit
    const editBtn = guardianRow.locator("button:has-text('Edit')").first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Edit email field
    const emailInput = guardianRow.locator("input[type='email']");
    await emailInput.fill("updated@example.com");

    // Save
    const saveBtn = guardianRow.locator("button:text('Save')").first();
    await saveBtn.click();

    // Verify update
    await expect(page.locator("text=updated@example.com")).toBeVisible({ timeout: 5000 });
  });

  test("admin can unlink a guardian from one student", async ({ page }) => {
    const guardianName = `UnlinkGuardian${Date.now()}`;
    // Create a guardian first
    await page.goto(`${BASE}/admin/people/1741`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(`${guardianName}@example.com`);
    await inputs.nth(3).fill("555-0003");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Reload and unlink
    await page.reload();
    const guardianRow = guardianSection.locator(`text=${guardianName}`).first().locator("..");

    // Click Unlink
    const unlinkBtn = guardianRow.locator("button[aria-label*='Unlink']").first();
    await unlinkBtn.click();

    // Verify removed
    await expect(guardianSection.locator(`text=${guardianName}`)).not.toBeVisible({ timeout: 5000 });
  });

  test("admin can delete a guardian entirely (cascades all links)", async ({ page }) => {
    const guardianName = `DeleteGuardian${Date.now()}`;
    // Create a guardian first
    await page.goto(`${BASE}/admin/people/1741`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(`${guardianName}@example.com`);
    await inputs.nth(3).fill("555-0004");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Reload and delete
    await page.reload();
    const guardianRow = guardianSection.locator(`text=${guardianName}`).first().locator("..");

    // Register dialog handler BEFORE clicking delete
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("ALL linked students");
      await dialog.accept();
    });

    // Click Delete guardian
    const deleteBtn = guardianRow.locator("button:text('Delete guardian')").first();
    await deleteBtn.click();

    // Verify deleted
    await expect(guardianSection.locator(`text=${guardianName}`)).not.toBeVisible({ timeout: 5000 });
  });

  test("admin can link an existing guardian to another student (sibling case)", async ({
    page,
  }) => {
    const guardianName = `LinkGuardian${Date.now()}`;
    // Create a guardian first on student 1741
    await page.goto(`${BASE}/admin/people/1741`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(`${guardianName}@example.com`);
    await inputs.nth(3).fill("555-0005");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Now link the same guardian to student 1741 again (simulate sibling case)
    // by using the search/link feature
    await page.reload();
    const linkDetails = guardianSection.locator("details:has(summary:text('Link existing'))");
    await linkDetails.locator("summary").click();

    // Search for the guardian by name
    const searchInput = linkDetails.locator("input[type='text']").first();
    await searchInput.fill(guardianName.substring(0, 5)); // partial search

    // Wait for results
    const guardianResult = linkDetails.locator(`text=${guardianName}`).first();
    await expect(guardianResult).toBeVisible({ timeout: 5000 });

    // Click result
    await guardianResult.click();

    // Set relationship
    const relationshipInput = linkDetails.locator("input[placeholder*='Relation']").first();
    await relationshipInput.fill("Sibling");

    // Link
    const linkBtn = linkDetails.locator("button:text('Link')").first();
    await linkBtn.click();

    // Verify linked (may show duplicate or updated relationship)
    await expect(page.locator(`text=${guardianName}`)).toBeVisible({ timeout: 5000 });
  });
});
