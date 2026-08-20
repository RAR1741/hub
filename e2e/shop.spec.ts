import { expect, test } from "@playwright/test";
import { mentorSessionCookie, studentSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await mentorSessionCookie(BASE)]);
});

test("shop dashboard: student+ gating, parts CRUD, linking tiles, polling + filter persistence, delete guards", async ({
  page,
  browser,
}) => {
  // More round trips than the original single-role test (mentor + student +
  // guest contexts, extra CRUD) plus the 15s poll wait — default 30s budget
  // is too tight.
  test.setTimeout(75_000);

  const stamp = Date.now();
  const projectName = `E2E Shop Project ${stamp}`;
  const prefix = `E2E${stamp}`.toUpperCase();

  let projectId = "";
  let assemblyId = "";
  let partId = "";

  try {
    // --- Mentor: create project -> assembly -> part, verify numbering ---
    const projRes = await page.request.post("/api/admin/projects", {
      data: { name: projectName, partNumberPrefix: prefix },
    });
    expect(projRes.status()).toBe(201);
    ({ id: projectId } = (await projRes.json()) as { id: string });

    const asmRes = await page.request.post("/api/admin/parts", {
      data: { projectId, type: "assembly", name: "Drivetrain" },
    });
    expect(asmRes.status()).toBe(201);
    const asmBody = (await asmRes.json()) as { id: string; partNumber: number };
    assemblyId = asmBody.id;
    expect(asmBody.partNumber).toBe(0); // first assembly of a project = 0

    const partRes = await page.request.post("/api/admin/parts", {
      data: { projectId, type: "part", name: "Gearbox plate", parentPartId: assemblyId },
    });
    expect(partRes.status()).toBe(201);
    const partBody = (await partRes.json()) as { id: string; partNumber: number };
    partId = partBody.id;
    expect(partBody.partNumber).toBe(1); // first child of assembly 0 = 1

    const assemblyNumber = `${prefix}-A-0000`;
    const partNumber = `${prefix}-P-0001`;

    await page.goto(`/admin/projects/${projectId}`);
    // The assembly number also appears as the child row's "Parent" link, so
    // there are legitimately two matches on the page — scope to first().
    await expect(page.getByText(assemblyNumber).first()).toBeVisible();
    await expect(page.getByText(partNumber).first()).toBeVisible();

    // --- Student context: parts CRUD is allowed, project CRUD is not ---
    const studentContext = await browser.newContext();
    await studentContext.addCookies([await studentSessionCookie(BASE)]);
    const studentPage = await studentContext.newPage();

    // Student CAN change a part's status via the inline cell.
    await studentPage.goto(`/admin/projects/${projectId}`);
    const partRow = studentPage.locator("tr", { hasText: partNumber });
    await partRow.getByLabel("Status").selectOption("cnc");
    await expect(partRow.getByLabel("Status")).toHaveValue("cnc");

    // Student CAN create a part.
    const studentPartRes = await studentPage.request.post("/api/admin/parts", {
      data: { projectId, type: "part", name: "Bumper mount", parentPartId: assemblyId },
    });
    expect(studentPartRes.status()).toBe(201);
    const studentPartBody = (await studentPartRes.json()) as { id: string };
    const studentPartId = studentPartBody.id;

    // Student CANNOT create a project — mentor-only.
    const studentProjectRes = await studentPage.request.post("/api/admin/projects", {
      data: { name: `${projectName} student`, partNumberPrefix: `${prefix}S` },
    });
    expect(studentProjectRes.status()).toBe(403);

    // --- Student CAN view the board; tiles link to part detail ---
    await studentPage.goto(`/shop/${projectId}`);
    await expect(studentPage.getByRole("heading", { name: "Ready for CNC" })).toBeVisible();
    const cncTile = studentPage.locator(".shop-tile", { hasText: partNumber });
    await expect(cncTile).toBeVisible();
    await expect(cncTile).toHaveAttribute("href", `/admin/parts/${partId}`);

    // Empty statuses are skipped entirely (welding has no parts in this project).
    await expect(studentPage.getByRole("heading", { name: "Waiting for welding" })).not.toBeVisible();
    // `done` is never shown unless it's the selected filter.
    await expect(studentPage.getByRole("heading", { name: "Done", exact: true })).not.toBeVisible();

    // --- Filter persists across a reload (URL param, not in-memory state) ---
    await studentPage.selectOption("#shop-status-filter", "cnc");
    await expect(studentPage).toHaveURL(/[?&]status=cnc/);
    await studentPage.reload();
    await expect(studentPage).toHaveURL(/[?&]status=cnc/);
    await expect(studentPage.locator("#shop-status-filter")).toHaveValue("cnc");
    await expect(studentPage.locator(".shop-tile", { hasText: partNumber })).toBeVisible();

    // Back to the unfiltered default board for the poll assertion below.
    await studentPage.selectOption("#shop-status-filter", "");
    await expect(studentPage).not.toHaveURL(/status=/);

    // --- Auto-refresh: mentor flips the part to `done`; board drops the
    // tile within one 10s poll cycle, with no reload on the student page. ---
    const patchRes = await page.request.patch(`/api/admin/parts/${partId}`, {
      data: { status: "done" },
    });
    expect(patchRes.status()).toBe(200);
    await expect(studentPage.locator(".shop-tile", { hasText: partNumber })).not.toBeVisible({
      timeout: 15_000,
    });

    // --- Guest is blocked: no board render, and the API 403s ---
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto(`/shop/${projectId}`);
    await expect(guestPage).toHaveURL(/\/login/);
    await expect(guestPage.locator(".shop-tile")).toHaveCount(0);

    const guestApiRes = await guestPage.request.get(`/api/shop/${projectId}`);
    expect(guestApiRes.status()).toBe(403);

    await guestContext.close();

    // --- Delete guards: children/parts block their parent, then unwind
    // cleanly. Part deletes are student-allowed; project delete is mentor-only. ---
    const delAssemblyBlocked = await studentPage.request.delete(`/api/admin/parts/${assemblyId}`);
    expect(delAssemblyBlocked.status()).toBe(409);
    const delProjectBlocked = await page.request.delete(`/api/admin/projects/${projectId}`);
    expect(delProjectBlocked.status()).toBe(409);

    const delStudentPart = await studentPage.request.delete(`/api/admin/parts/${studentPartId}`);
    expect(delStudentPart.status()).toBe(200);

    const delPart = await studentPage.request.delete(`/api/admin/parts/${partId}`);
    expect(delPart.status()).toBe(200);
    partId = "";

    const delAssembly = await studentPage.request.delete(`/api/admin/parts/${assemblyId}`);
    expect(delAssembly.status()).toBe(200);
    assemblyId = "";

    await studentContext.close();

    const delProject = await page.request.delete(`/api/admin/projects/${projectId}`);
    expect(delProject.status()).toBe(200);
    projectId = "";
  } finally {
    // Best-effort cleanup in case an assertion above threw mid-test.
    if (partId) await page.request.delete(`/api/admin/parts/${partId}`).catch(() => {});
    if (assemblyId) await page.request.delete(`/api/admin/parts/${assemblyId}`).catch(() => {});
    if (projectId) await page.request.delete(`/api/admin/projects/${projectId}`).catch(() => {});
  }
});
