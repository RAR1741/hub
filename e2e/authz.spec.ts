import { expect, test, request as pwRequest } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test("guest gets 403 from an admin API (server-enforced, not just hidden UI)", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/admin/build-days", { data: { date: "2026-09-01", kind: "required" } });
  expect(res.status()).toBe(403);
  await ctx.dispose();
});

test("guest is redirected away from /calendar", async ({ page }) => {
  await page.goto("/calendar");
  // redirect("/") lands the guest on the dashboard
  expect(new URL(page.url()).pathname).toBe("/");
});
