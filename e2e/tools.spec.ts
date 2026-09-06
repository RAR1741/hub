import { expect, test } from "@playwright/test";
import { mentorSessionCookie, studentSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await mentorSessionCookie(BASE)]);
});

test("tool inventory + checks + delete requests: student logging, mentor review, guest gating", async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const assetTag = `E2E-${stamp}`;
  const tool = {
    name: `E2E Tool ${stamp}`,
    category: "hand tool",
    location: "shop",
    assetTag,
    status: "in_service",
    maintenanceIntervalDays: 90,
    notes: null,
  };

  let toolId = "";
  let requestId = "";

  const studentContext = await browser.newContext();
  await studentContext.addCookies([await studentSessionCookie(BASE)]);
  const studentPage = await studentContext.newPage();

  try {
    // --- Student: create a tool ---
    const createRes = await studentPage.request.post("/api/tools", { data: tool });
    expect(createRes.status()).toBe(201);
    ({ id: toolId } = (await createRes.json()) as { id: string });

    // --- Duplicate asset tag -> 409 ---
    const dupRes = await studentPage.request.post("/api/tools", { data: tool });
    expect(dupRes.status()).toBe(409);

    // --- Student UI: sees the tool and "New tool" ---
    await studentPage.goto("/tools");
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage.getByRole("link", { name: tool.name })).toBeVisible();
    await expect(studentPage.getByText("New tool")).toBeVisible();

    // --- Student: log a check that flips status to out_of_service (trigger) ---
    const checkRes = await studentPage.request.post("/api/tool-checks", {
      data: { toolId, kind: "inspection", condition: "poor", statusAfter: "out_of_service", notes: null },
    });
    expect(checkRes.status()).toBe(201);

    await studentPage.goto(`/tools/${toolId}`);
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage.getByText("out of service").first()).toBeVisible();
    const checkRow = studentPage.locator("tr", { hasText: "Test Student" });
    await expect(checkRow).toBeVisible();

    // --- Student: retire the tool, then a check with statusAfter in_service does not un-retire it ---
    const retireRes = await studentPage.request.patch(`/api/tools/${toolId}`, {
      data: { ...tool, status: "retired" },
    });
    expect(retireRes.status()).toBe(200);

    const postRetireCheckRes = await studentPage.request.post("/api/tool-checks", {
      data: { toolId, kind: "inspection", condition: "good", statusAfter: "in_service", notes: null },
    });
    expect(postRetireCheckRes.status()).toBe(201);

    await studentPage.goto(`/tools/${toolId}`);
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage.getByText("retired").first()).toBeVisible();

    // --- Student: tool deletion is mentor-only ---
    const studentDeleteRes = await studentPage.request.delete(`/api/tools/${toolId}`);
    expect(studentDeleteRes.status()).toBe(403);

    // --- Student: request deletion -> 201, second request -> 409 ---
    const reqRes = await studentPage.request.post("/api/tool-delete-requests", {
      data: { toolId, reason: "Broken beyond repair" },
    });
    expect(reqRes.status()).toBe(201);
    ({ id: requestId } = (await reqRes.json()) as { id: string });

    const dupReqRes = await studentPage.request.post("/api/tool-delete-requests", {
      data: { toolId, reason: "Broken beyond repair" },
    });
    expect(dupReqRes.status()).toBe(409);

    await studentPage.goto(`/tools/${toolId}`);
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage.getByText("Deletion requested")).toBeVisible();

    // --- Mentor: sees the tool name on /admin/requests, denies ---
    await page.goto("/admin/requests");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(tool.name)).toBeVisible();

    const denyRes = await page.request.post(`/api/admin/requests/tool-delete/${requestId}`, {
      data: { decision: "deny" },
    });
    expect(denyRes.status()).toBe(200);

    // --- Tool still exists after denial ---
    const stillThereRes = await page.request.get(`/tools/${toolId}`);
    expect(stillThereRes.status()).toBe(200);

    // --- Student: re-request deletion -> new 201 ---
    const reReqRes = await studentPage.request.post("/api/tool-delete-requests", {
      data: { toolId, reason: "Still broken" },
    });
    expect(reReqRes.status()).toBe(201);
    const { id: reRequestId } = (await reReqRes.json()) as { id: string };
    expect(reRequestId).not.toBe(requestId);
    requestId = reRequestId;

    // --- Mentor: approves -> tool cascaded away ---
    const approveRes = await page.request.post(`/api/admin/requests/tool-delete/${requestId}`, {
      data: { decision: "approve" },
    });
    expect(approveRes.status()).toBe(200);
    requestId = ""; // request row is gone along with the tool

    const goneRes = await page.request.get(`/tools/${toolId}`);
    expect(goneRes.status()).toBe(404);
    toolId = ""; // already deleted

    // --- Guest: no session, redirected to /login ---
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto("/tools");
    await expect(guestPage).toHaveURL(/\/login/);
    await guestContext.close();
  } finally {
    await studentContext.close();
    if (toolId) await page.request.delete(`/api/tools/${toolId}`).catch(() => {});
  }
});
