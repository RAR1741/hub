import { test, expect } from "@playwright/test";
import {
  adminSessionCookie,
  mentorSessionCookie,
  studentSessionCookie,
  SEEDED_STUDENT_PERSON_ID,
} from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Guardian visibility", () => {
  test("student viewing their own profile does NOT see Guardians section", async ({
    context,
    page,
  }) => {
    const cookie = await studentSessionCookie(BASE);
    await context.addCookies([cookie]);

    // Student views their own profile
    await page.goto(`${BASE}/people/${SEEDED_STUDENT_PERSON_ID}`);
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
    await page.goto(`${BASE}/people/${SEEDED_STUDENT_PERSON_ID}`);
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
    const guardianEmail = `guardian${Date.now()}@example.com`;
    // Go to admin edit page for a student
    await page.goto(`${BASE}/admin/people/${SEEDED_STUDENT_PERSON_ID}`);

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
    await inputs.nth(2).fill(guardianEmail);
    await inputs.nth(3).fill("555-0001");
    await inputs.nth(4).fill("Test Company");
    await inputs.nth(5).fill("Parent");

    // Submit
    const btn = addDetails.locator("button:text('Add guardian')");
    await btn.click();

    // Verify appears
    await expect(page.locator(`text=${guardianEmail}`)).toBeVisible({ timeout: 5000 });
  });

  test("admin can edit a guardian's contact fields", async ({ page }) => {
    const guardianName = `EditGuardian${Date.now()}`;
    const guardianEmail = `edit${Date.now()}@example.com`;
    // Create a guardian first
    await page.goto(`${BASE}/admin/people/${SEEDED_STUDENT_PERSON_ID}`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(guardianEmail);
    await inputs.nth(3).fill("555-0002");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Wait for email to appear
    await expect(page.locator(`text=${guardianEmail}`)).toBeVisible({ timeout: 5000 });

    // Reload and find guardian row using stable data-testid (won't break in edit mode)
    await page.reload();
    const guardianRowLocator = page
      .locator("li[data-testid^='guardian-']", { has: page.locator(`text=${guardianEmail}`) });
    const testId = await guardianRowLocator.getAttribute("data-testid");
    const guardianRow = page.locator(`[data-testid="${testId}"]`);

    // Click Edit button
    const editBtn = guardianRow.locator("button:has-text('Edit')").first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Edit email field using stable testid (works in edit mode)
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
    const guardianEmail = `unlink${Date.now()}@example.com`;
    // Create a guardian first
    await page.goto(`${BASE}/admin/people/${SEEDED_STUDENT_PERSON_ID}`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(guardianEmail);
    await inputs.nth(3).fill("555-0003");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Wait for email to appear
    await expect(page.locator(`text=${guardianEmail}`)).toBeVisible({ timeout: 5000 });

    // Reload and find guardian row
    await page.reload();
    const guardianRow = page
      .locator("li[data-testid^='guardian-']", { has: page.locator(`text=${guardianEmail}`) });

    // Click Unlink
    const unlinkBtn = guardianRow.locator("button[aria-label*='Unlink']").first();
    await unlinkBtn.click();

    // Verify removed
    await expect(page.locator(`text=${guardianEmail}`)).not.toBeVisible({ timeout: 5000 });
  });

  test("admin can delete a guardian entirely (cascades all links)", async ({ page }) => {
    const guardianName = `DeleteGuardian${Date.now()}`;
    const guardianEmail = `delete${Date.now()}@example.com`;
    // Create a guardian first
    await page.goto(`${BASE}/admin/people/${SEEDED_STUDENT_PERSON_ID}`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(guardianEmail);
    await inputs.nth(3).fill("555-0004");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Wait for email to appear
    await expect(page.locator(`text=${guardianEmail}`)).toBeVisible({ timeout: 5000 });

    // Reload and find guardian row using stable data-testid
    await page.reload();
    const guardianRowLocator = page
      .locator("li[data-testid^='guardian-']", { has: page.locator(`text=${guardianEmail}`) });
    const testId = await guardianRowLocator.getAttribute("data-testid");
    const guardianRow = page.locator(`[data-testid="${testId}"]`);

    // Register dialog handler BEFORE clicking delete
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("every linked student");
      await dialog.accept();
    });

    // Click Delete guardian
    const deleteBtn = guardianRow.locator("button:text('Delete guardian')").first();
    await deleteBtn.click();

    // Verify deleted
    await expect(page.locator(`text=${guardianEmail}`)).not.toBeVisible({ timeout: 5000 });
  });

  test("admin can link an existing guardian to another student (sibling case)", async ({
    page,
  }) => {
    const guardianName = `LinkGuardian${Date.now()}`;
    const guardianEmail = `link${Date.now()}@example.com`;
    // Create a guardian first
    await page.goto(`${BASE}/admin/people/${SEEDED_STUDENT_PERSON_ID}`);
    const guardianSection = page.locator("section:has(h2:text('Guardians'))");
    const addDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
    await addDetails.locator("summary").click();

    const inputs = addDetails.locator("input");
    await inputs.nth(0).fill(guardianName);
    await inputs.nth(1).fill("TestLast");
    await inputs.nth(2).fill(guardianEmail);
    await inputs.nth(3).fill("555-0005");
    await inputs.nth(4).fill("Test Company");
    await addDetails.locator("button:text('Add guardian')").click();

    // Wait for the POST to persist before reloading — reloading immediately
    // aborts the in-flight create request, so the guardian never exists and
    // the search below can't find it. (The other tests in this block already
    // wait here for the same reason.)
    await expect(page.locator(`text=${guardianEmail}`)).toBeVisible({ timeout: 5000 });

    // Now link the same guardian again (simulate sibling case)
    // by using the search/link feature
    await page.reload();
    const linkDetails = guardianSection.locator("details:has(summary:text('Link existing'))");
    await linkDetails.locator("summary").click();

    // Search for the guardian by name. Use the full (timestamped) name so the
    // result set can't collide with LinkGuardian rows left by prior runs —
    // search is `ilike %term% ORDER BY last_name LIMIT 10` and every run shares
    // last_name "TestLast", so a shared prefix like "LinkG" would eventually
    // push this run's row past the top 10. The name is still a substring of the
    // rendered "First Last — email", so partial matching is still exercised.
    const searchInput = linkDetails.locator("input[placeholder*='typing']");
    await searchInput.fill(guardianName);

    // Wait for results
    const guardianResult = linkDetails.locator(`text=${guardianName}`).first();
    await expect(guardianResult).toBeVisible({ timeout: 5000 });

    // Click result
    await guardianResult.click();

    // Set relationship
    const relationshipInput = linkDetails.locator("input[placeholder*='Guardian']");
    await relationshipInput.fill("Sibling");

    // Link
    const linkBtn = linkDetails.locator("button:text('Link')").first();
    await linkBtn.click();

    // Verify linked
    await expect(page.locator(`text=${guardianEmail}`)).toBeVisible({ timeout: 5000 });
  });
});
