import { expect, test } from "@playwright/test";
import { mentorSessionCookie, studentSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await mentorSessionCookie(BASE)]);
});

test("battery inventory + usage log: mentor CRUD, student logging, guest gating", async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const number = `E2E-${stamp}`;
  const battery = { number, status: "active", model: "NP18-12B", ampHourRating: 17.2 };

  let batteryId = "";
  let usageId = "";

  try {
    // --- Mentor: create a battery ---
    const createRes = await page.request.post("/api/batteries", { data: battery });
    expect(createRes.status()).toBe(201);
    ({ id: batteryId } = (await createRes.json()) as { id: string });

    // --- Duplicate number -> 409 ---
    const dupRes = await page.request.post("/api/batteries", { data: battery });
    expect(dupRes.status()).toBe(409);

    // --- Student: battery creation is mentor-only ---
    const studentContext = await browser.newContext();
    await studentContext.addCookies([await studentSessionCookie(BASE)]);
    const studentPage = await studentContext.newPage();

    const studentCreateRes = await studentPage.request.post("/api/batteries", { data: battery });
    expect(studentCreateRes.status()).toBe(403);

    // --- Student UI: sees the battery and the log form, not the mentor-only "New battery" form ---
    await studentPage.goto("/batteries");
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage.getByRole("link", { name: number })).toBeVisible();
    await expect(studentPage.getByText("New battery")).toHaveCount(0);

    await studentPage.getByLabel("Battery").selectOption(batteryId);
    await studentPage.getByLabel("Charge % after (optional)").fill("130"); // no upper clamp

    const [usageRes] = await Promise.all([
      studentPage.waitForResponse(
        (r) => r.url().includes("/api/battery-usage") && r.request().method() === "POST",
      ),
      studentPage.getByRole("button", { name: "Log usage" }).click(),
    ]);
    expect(usageRes.status()).toBe(201);
    ({ id: usageId } = (await usageRes.json()) as { id: string });

    const row = studentPage.locator("tr", { hasText: number }).filter({ hasText: "Test Student" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("130");

    await studentContext.close();

    // --- Guest: no session, redirected to /login ---
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto("/batteries");
    await expect(guestPage).toHaveURL(/\/login/);
    await guestContext.close();
  } finally {
    if (usageId) await page.request.delete(`/api/battery-usage/${usageId}`).catch(() => {});
    if (batteryId) {
      await page.request
        .patch(`/api/batteries/${batteryId}`, { data: { ...battery, status: "retired" } })
        .catch(() => {});
    }
  }
});
