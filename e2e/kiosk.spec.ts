import { expect, test, request as pwRequest } from "@playwright/test";
import { createHash } from "node:crypto";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TOKEN = "e2e-kiosk-token";
const HASH = createHash("sha256").update(TOKEN).digest("hex");

// NOTE: this spec assumes a kiosk_device row with token_hash = HASH exists.
// Insert it once before running (documented in Step 5 of the task-11 brief;
// the CI e2e job seeds it right after the DB reset):
//   insert into kiosk_device (name, token_hash) values ('E2E Tablet', '<HASH>');
// Locally:
//   ./dev npm run db:psql -- -c "insert into kiosk_device (name, token_hash) values ('E2E Tablet', '<HASH>');"

test("kiosk sign-in -> who's-here -> sign-out round trip", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });

  // Register the tablet (sets the kiosk cookie in this context's jar).
  const setup = await ctx.post("/api/kiosk/setup", { data: { token: TOKEN } });
  expect(setup.status()).toBe(200);

  // The seeded student's id is exported by the local/CI setup step as
  // E2E_STUDENT_ID (select id from person where student_id_number='1741').
  const personId = process.env.E2E_STUDENT_ID;
  test.skip(!personId, "E2E_STUDENT_ID not provided");

  const inRes = await ctx.post("/api/kiosk/clock-in", { data: { personId } });
  expect(inRes.status()).toBe(200);

  const here1 = await (await ctx.get("/api/whos-here")).json();
  expect(here1.here.length).toBeGreaterThanOrEqual(1);

  const outRes = await ctx.post("/api/kiosk/clock-out", { data: { personId } });
  expect(outRes.status()).toBe(200);

  await ctx.dispose();
});

console.log(`[kiosk.spec] expecting kiosk_device.token_hash = ${HASH}`);
