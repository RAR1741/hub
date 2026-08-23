import { expect, test } from "@playwright/test";
import { createPanelToken } from "../src/lib/onshape-panel-token";
import { deleteOnshapeConnection, seedOnshapeConnection } from "./helpers/db";
import { SEEDED_STUDENT_PERSON_ID, mentorSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PANEL_TOKEN_KEY = "hub:onshape-panel-token"; // must match OnshapePanel.tsx's TOKEN_KEY

/**
 * Real surface covered vs. stubbed (design doc §5/§7):
 *
 * - REAL: `/onshape` page + `<OnshapePanel>`, `/api/onshape/panel/context`,
 *   `/api/onshape/panel/parts`, `createPart`/numbering, the linkage-unique
 *   index, `PATCH /api/admin/parts/[id]` (inline status), and
 *   `listElementParts`/`getFreshAccessToken` against the real dev mock at
 *   `src/app/api/dev/onshape-mock/*` (env-pointed via `.env.local`, see
 *   `src/lib/onshape.ts`).
 * - STUBBED: the `/onshape/connect` popup and the Onshape OAuth authorize
 *   screen. Driving those headlessly would mean pointing
 *   `ONSHAPE_AUTHORIZATION_URL` at something too — there's no local stand-in
 *   for oauth.onshape.com's actual authorize UI, only for the mock's token
 *   and parts endpoints. Instead: mint a panel JWT the same way
 *   `/onshape/connect` does (`createPanelToken`, same `STUDENT_SESSION_SECRET`)
 *   and seed an `onshape_connection` row directly (`seedOnshapeConnection`) —
 *   this is exactly the state the popup would have produced, so everything
 *   downstream of "the person is connected" runs unmodified.
 */

test.describe("Onshape panel", () => {
  test("list -> add -> status change -> reload round trip", async ({ page, browser }) => {
    test.setTimeout(45_000);

    const stamp = Date.now();
    const projectName = `E2E Onshape Project ${stamp}`;
    const prefix = `EOS${stamp}`.toUpperCase();
    const assemblyName = `E2E Onshape Assembly ${stamp}`;
    const documentId = `e2e-doc-${stamp}`;
    const elementId = `e2e-elem-${stamp}`;
    const workspaceOrVersionId = `e2e-ws-${stamp}`;
    const personId = SEEDED_STUDENT_PERSON_ID;

    let projectId = "";
    let assemblyId = "";
    let createdPartId = "";

    // Mentor-only setup context: create the project + parent assembly the
    // Add form needs. A separate context/page from the panel's `page` so the
    // panel run below stays cookie-free, matching the real cross-origin
    // iframe (no hub cookies reach onshape.com; identity is bearer-only).
    const setupContext = await browser.newContext();
    const setupPage = await setupContext.newPage();

    try {
      await setupContext.addCookies([await mentorSessionCookie(BASE)]);

      const projRes = await setupPage.request.post("/api/admin/projects", {
        data: { name: projectName, partNumberPrefix: prefix },
      });
      expect(projRes.status()).toBe(201);
      ({ id: projectId } = (await projRes.json()) as { id: string });

      const asmRes = await setupPage.request.post("/api/admin/parts", {
        data: { projectId, type: "assembly", name: assemblyName },
      });
      expect(asmRes.status()).toBe(201);
      ({ id: assemblyId } = (await asmRes.json()) as { id: string });

      await seedOnshapeConnection(personId);

      const secret = process.env.STUDENT_SESSION_SECRET;
      if (!secret) throw new Error("STUDENT_SESSION_SECRET must be set for E2E");
      const panelToken = await createPanelToken(personId, secret);

      const panelUrl =
        `${BASE}/onshape?documentId=${documentId}&workspaceOrVersion=w` +
        `&workspaceOrVersionId=${workspaceOrVersionId}&elementId=${elementId}`;

      // First load has no token yet (mirrors a fresh iframe before Connect) —
      // navigate once to establish the origin, seed the token like the
      // /onshape/connect popup's postMessage would, then reload so the
      // panel's mount effect picks it up from localStorage.
      await page.goto(panelUrl);
      await page.evaluate(
        ([key, token]) => localStorage.setItem(key, token),
        [PANEL_TOKEN_KEY, panelToken],
      );
      await page.reload();

      const drivePlateRow = page.locator(".onshape-part-row", {
        has: page.locator(".onshape-part-name", { hasText: "Left Drive Plate" }),
      });
      const spacerRow = page.locator(".onshape-part-row", {
        has: page.locator(".onshape-part-name", { hasText: "Spacer" }),
      });

      // 1. Neither mock part is tracked yet -> both show Add.
      await expect(drivePlateRow).toBeVisible({ timeout: 10_000 });
      await expect(spacerRow).toBeVisible();
      await expect(drivePlateRow.getByRole("button", { name: "Add" })).toBeVisible();
      await expect(spacerRow.getByRole("button", { name: "Add" })).toBeVisible();

      // 2. Add "Left Drive Plate" -> pick the seeded project + assembly, submit.
      await drivePlateRow.getByRole("button", { name: "Add" }).click();
      const form = drivePlateRow.locator("form");
      await expect(form).toBeVisible();
      // Select by option `value` (the project/assembly id) rather than by
      // label text — the assembly option's label is `${fullPartNumber} ${name}`
      // and the accessible-name-from-content computation for a <select>
      // nested in its own <label> is fiddly to match exactly. Select order in
      // the form is Name, Type, Project, Parent assembly, Notes.
      const selects = form.locator("select");
      await selects.nth(1).selectOption(projectId); // Project
      await selects.nth(2).selectOption(assemblyId); // Parent assembly
      await form.getByRole("button", { name: "Add" }).click();

      const fullNumberLocator = drivePlateRow.locator(
        "span.font-mono",
        { hasText: new RegExp(`^${prefix}-P-\\d{5}$`) },
      );
      await expect(fullNumberLocator).toBeVisible({ timeout: 10_000 });
      await expect(drivePlateRow.getByRole("button", { name: "Add" })).not.toBeVisible();

      const openLink = drivePlateRow.getByRole("link", { name: "Open" });
      const href = await openLink.getAttribute("href");
      createdPartId = href?.split("/").pop() ?? "";
      expect(createdPartId).not.toBe("");

      // 3. Change status inline -> persists across a reload.
      const statusSelect = drivePlateRow.getByLabel("Status");
      await expect(statusSelect).toHaveValue("designing");
      await statusSelect.selectOption("material");
      await expect(statusSelect).toHaveValue("material");

      await page.reload();
      const reloadedRow = page.locator(".onshape-part-row", {
        has: page.locator(".onshape-part-name", { hasText: "Left Drive Plate" }),
      });
      await expect(reloadedRow.getByLabel("Status")).toHaveValue("material", { timeout: 10_000 });
      await expect(reloadedRow.getByRole("button", { name: "Add" })).not.toBeVisible();

      // 4. sessionStorage warm-cache was written for this context (component's
      // 30-min-TTL cache, keyed by the context params) — proves the cache
      // path ran, without relying on flaky "painted before network" timing.
      const cached = await page.evaluate(() =>
        Object.keys(sessionStorage).some((k) => k.startsWith("hub:onshape-panel-context:")),
      );
      expect(cached).toBe(true);
    } finally {
      // Best-effort cleanup, children before parents (restrict FK), mirroring
      // shop.spec.ts's try/finally teardown pattern.
      if (createdPartId) {
        await setupPage.request.delete(`/api/admin/parts/${createdPartId}`).catch(() => {});
      }
      if (assemblyId) {
        await setupPage.request.delete(`/api/admin/parts/${assemblyId}`).catch(() => {});
      }
      if (projectId) {
        await setupPage.request.delete(`/api/admin/projects/${projectId}`).catch(() => {});
      }
      await deleteOnshapeConnection(personId).catch(() => {});
      await setupContext.close();
    }
  });
});
