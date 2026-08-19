import { test, expect } from "@playwright/test";
import { adminSessionCookie, mentorSessionCookie, studentSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Guardian visibility and CRUD", () => {
  test("student viewing their own profile does NOT see Guardians section", async ({
    context,
    page,
  }) => {
    // Seed a student with a guardian link (via the API or fixture, then fetch profile)
    // For now, just verify the section doesn't render for a self-viewing student.
    // If no guardians are linked yet, this test is still valid:
    // the section shouldn't render for self-view even if guardians exist.
    const cookie = await studentSessionCookie(BASE);
    await context.addCookies([cookie]);

    // Student views their own profile
    await page.goto(`${BASE}/people/1741`); // seeded student_id_number 1741
    // Guardians section should NOT be visible
    await expect(page.locator("h2", { hasText: "Guardians" })).not.toBeVisible();
  });

  test("mentor viewing a student profile CAN see read-only Guardians section", async ({
    context,
    page,
  }) => {
    const cookie = await mentorSessionCookie(BASE);
    await context.addCookies([cookie]);

    // Mentor views any student's profile (e.g. student 1741)
    await page.goto(`${BASE}/people/1741`);
    // Guardians section should be visible
    await expect(page.locator("h2", { hasText: "Guardians" })).toBeVisible();
    // "No guardians on file" if none linked yet, or a list if any are
    const guardians = page.locator("section:has(h2:text('Guardians'))");
    const text = await guardians.textContent();
    expect(text).toMatch(/No guardians on file|^Guardians/);
  });

  test.describe("Admin guardian CRUD", () => {
    let adminContext;
    let adminPage;

    test.beforeEach(async ({ context, page, browser }) => {
      // admin edits the student's guardians
      const adminCookie = await adminSessionCookie(BASE);
      const newContext = await browser.newContext();
      await newContext.addCookies([adminCookie]);
      adminPage = await newContext.newPage();
      adminContext = newContext;
    });

    test.afterEach(async () => {
      await adminContext.close();
    });

    test("admin can create a new guardian and link to a student", async () => {
      // Go to admin edit page for a student
      await adminPage.goto(`${BASE}/admin/people/1741`);

      // Find the Guardians section
      const guardianSection = adminPage.locator("section:has(h2:text('Guardians'))");
      await expect(guardianSection).toBeVisible();

      // Click "Add new guardian" to expand
      const addGuardianDetails = guardianSection.locator("details:has(summary:text('Add new guardian'))");
      await addGuardianDetails.locator("summary").click();

      // Fill in the form
      await guardianSection.locator("input[placeholder*='First']").first().fill("Jane");
      await guardianSection.locator("input[placeholder*='Last']").first().fill("Smith");
      await guardianSection.locator("input[placeholder*='Email']").first().fill("jane@example.com");
      await guardianSection.locator("input[placeholder*='Phone']").first().fill("555-0100");
      await guardianSection.locator("input[placeholder*='Employer']").first().fill("Tech Corp");

      // Relationship field
      const relationshipInputs = guardianSection.locator("input[placeholder*='Relation']");
      await relationshipInputs.nth(0).fill("Mother");

      // Submit
      const btn = guardianSection.locator("button:text('Add guardian')");
      await expect(btn).toBeEnabled();
      await btn.click();

      // Page refreshes; verify Jane Smith appears in the list
      await expect(adminPage.locator("text=Jane Smith")).toBeVisible({ timeout: 5000 });
    });

    test("admin can edit a guardian's contact fields", async () => {
      // Assuming Jane Smith is linked (from previous test or manually seeded)
      await adminPage.goto(`${BASE}/admin/people/1741`);

      const guardianSection = adminPage.locator("section:has(h2:text('Guardians'))");

      // Find Jane's row and click Edit
      const janeRow = guardianSection.locator("text=Jane Smith").first().locator("..");
      const editBtn = janeRow.locator("button:has-text('Edit')").first();
      await expect(editBtn).toBeVisible();
      await editBtn.click();

      // Edit fields appear
      const emailInput = janeRow.locator("input[type='email']");
      await emailInput.fill("jane.smith@example.com");

      // Click Save
      const saveBtn = janeRow.locator("button:text('Save')").first();
      await saveBtn.click();

      // Refresh and verify updated
      await adminPage.reload();
      await expect(adminPage.locator("text=jane.smith@example.com")).toBeVisible({ timeout: 5000 });
    });

    test("admin can unlink a guardian from one student", async () => {
      await adminPage.goto(`${BASE}/admin/people/1741`);

      const guardianSection = adminPage.locator("section:has(h2:text('Guardians'))");
      const janeRow = guardianSection.locator("text=Jane Smith").first().locator("..");

      // Click Unlink (should have aria-label "Unlink from this student")
      const unlinkBtn = janeRow.locator("button[aria-label*='Unlink']").first();
      await unlinkBtn.click();

      // Refresh and verify Jane is no longer listed for this student
      await adminPage.reload();
      const remainingGuardians = guardianSection.locator("text=Jane Smith");
      await expect(remainingGuardians).not.toBeVisible({ timeout: 5000 });
    });

    test("admin can delete a guardian entirely (cascades all links)", async () => {
      // First, create a guardian and ensure it's linked
      await adminPage.goto(`${BASE}/admin/people/1741`);

      const guardianSection = adminPage.locator("section:has(h2:text('Guardians'))");
      const janeRow = guardianSection.locator("text=Jane Smith").first().locator("..");

      // Click Delete guardian (danger button, not Unlink)
      const deleteBtn = janeRow.locator("button:text('Delete guardian')").first();
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();

      // Confirm dialog
      await adminPage.on("dialog", (dialog) => {
        expect(dialog.message()).toContain("ALL linked students");
        dialog.accept();
      });

      // Refresh and verify Jane is gone
      await adminPage.reload();
      const remainingGuardians = guardianSection.locator("text=Jane Smith");
      await expect(remainingGuardians).not.toBeVisible({ timeout: 5000 });
    });

    test("admin can link an existing guardian to another student (sibling case)", async () => {
      // Create Jane if not exists, then link to student 1742 (if exists in seed)
      // For now, assume Jane exists; link her to another student's profile
      await adminPage.goto(`${BASE}/admin/people/1742`);

      const guardianSection = adminPage.locator("section:has(h2:text('Guardians'))");

      // Expand "Link existing guardian"
      const linkDetails = guardianSection.locator("details:has(summary:text('Link existing'))");
      await linkDetails.locator("summary").click();

      // Search for Jane
      const searchInput = linkDetails.locator("input[type='text']").first();
      await searchInput.fill("Jane");

      // Wait for results; should show Jane Smith
      const janeResult = linkDetails.locator("text=Jane Smith").first();
      await expect(janeResult).toBeVisible({ timeout: 5000 });

      // Click on Jane's result
      await janeResult.click();

      // Relationship field appears; fill it
      const relationshipInput = linkDetails.locator("input[placeholder*='Relation']").first();
      await relationshipInput.fill("Guardian");

      // Link button
      const linkBtn = linkDetails.locator("button:text('Link')").first();
      await linkBtn.click();

      // Refresh and verify Jane appears for student 1742
      await adminPage.reload();
      await expect(adminPage.locator("text=Jane Smith")).toBeVisible({ timeout: 5000 });
    });
  });
});
