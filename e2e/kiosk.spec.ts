import { expect, test, request as pwRequest } from "@playwright/test";
import { createHash } from "node:crypto";
import { seedKioskDevice, seededStudentPersonId } from "./helpers/db";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TOKEN = "e2e-kiosk-token";
const HASH = createHash("sha256").update(TOKEN).digest("hex");

test.beforeAll(async () => {
  await seedKioskDevice(HASH);
});

test("kiosk sign-in -> who's-here -> sign-out round trip", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });

  // Register the tablet (sets the kiosk cookie in this context's jar).
  const setup = await ctx.post("/api/kiosk/setup", { data: { token: TOKEN } });
  expect(setup.status()).toBe(200);

  const personId = await seededStudentPersonId();

  const inRes = await ctx.post("/api/kiosk/clock-in", { data: { personId } });
  expect(inRes.status()).toBe(200);

  const here1 = await (await ctx.get("/api/whos-here")).json();
  expect(here1.here.length).toBeGreaterThanOrEqual(1);

  const outRes = await ctx.post("/api/kiosk/clock-out", { data: { personId } });
  expect(outRes.status()).toBe(200);

  await ctx.dispose();
});
