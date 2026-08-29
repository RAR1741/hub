import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { KIOSK_COOKIE } from "../src/lib/kiosk";
import { closeOpenSessionsForPerson, seedKioskDevice } from "./helpers/db";
import { SEEDED_STUDENT_PERSON_ID } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TOKEN = "e2e-realtime-kiosk-token";
const HASH = createHash("sha256").update(TOKEN).digest("hex");
const STUDENT_NAME = "Test Student"; // supabase/seed.sql: SEEDED_STUDENT_PERSON_ID

// Local `./dev` runs Playwright's browser inside the app container, where
// NEXT_PUBLIC_SUPABASE_URL (host-facing, 127.0.0.1) is unreachable — the
// browser-side Supabase Realtime websocket gets ERR_CONNECTION_REFUSED. CI
// runs supabase/next/chromium flat on one runner sharing 127.0.0.1, so this
// spec only runs there.
test.skip(
  !process.env.CI,
  "browser-side Supabase websocket is unreachable from in-container Playwright; this spec runs in CI, where supabase/next/chromium share one host",
);

function kioskCookie() {
  return { name: KIOSK_COOKIE, value: TOKEN, url: BASE };
}

test.beforeAll(async () => {
  await seedKioskDevice(HASH);
});

test.beforeEach(async () => {
  // Start every run from "signed out" regardless of what a prior run (or
  // kiosk.spec.ts, which shares the same seeded student) left behind.
  await closeOpenSessionsForPerson(SEEDED_STUDENT_PERSON_ID);
});

test("cross-kiosk realtime sync: clock-in/out on one kiosk reflects on another without reload", async ({
  browser,
}) => {
  // Two separate browser contexts = two physically distinct kiosk tablets,
  // each independently registered via the kiosk cookie.
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.addCookies([kioskCookie()]);
  await contextB.addCookies([kioskCookie()]);
  const kioskA = await contextA.newPage();
  const kioskB = await contextB.newPage();

  // Attach before navigating so we don't miss the websocket's own open event.
  const kioskBRealtimeWs = kioskB.waitForEvent("websocket", {
    predicate: (ws) => ws.url().includes("/realtime/v1/websocket"),
  });

  // Arm the join-ok frame wait as soon as B's socket is created — the reply
  // frame fires within milliseconds of the join, so the listener must be
  // attached before navigation gets that far, not after the toBeVisible awaits.
  const kioskBJoined = kioskBRealtimeWs.then((ws) =>
    ws.waitForEvent("framereceived", {
      predicate: (f) =>
        typeof f.payload === "string" &&
        f.payload.includes("hub:presence") &&
        f.payload.includes('"status":"ok"'),
      timeout: 20_000,
    }),
  );

  await kioskA.goto("/kiosk");
  await kioskB.goto("/kiosk");

  // Sanity check: both boards loaded as registered kiosks, not the "not
  // registered" placeholder.
  await expect(kioskA.getByLabel("Search names")).toBeVisible();
  await expect(kioskB.getByLabel("Search names")).toBeVisible();
  await expect(kioskB.getByRole("button", { name: STUDENT_NAME, exact: true })).toBeVisible();

  // Prove kiosk B's realtime channel has actually joined before A acts.
  // Without this, A can clock in before B's connect chain (token fetch ->
  // setAuth -> ws connect -> channel join) finishes, and the later assertion
  // would only be saved by B's own subscribe-time refetch — passing without
  // ever exercising a real broadcast. Match Phoenix's join-ok reply frame for
  // our topic (Supabase prefixes it, e.g. "realtime:hub:presence").
  await kioskBJoined;

  // Clock the student in on kiosk A by driving the real UI.
  await kioskA.getByLabel("Search names").fill(STUDENT_NAME);
  await kioskA.getByRole("button", { name: STUDENT_NAME, exact: true }).click();
  await expect(kioskA.getByText(`Signed in ${STUDENT_NAME}`)).toBeVisible();

  // Kiosk B never reloads or navigates — the realtime broadcast should drive
  // a router.refresh() that moves the student into "On the clock" on its
  // own. Generous timeout: realtime + refetch has latency, up to ~10s is
  // still "realtime" by design.
  await expect(
    kioskB.locator(".k-here").getByText(STUDENT_NAME, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  // And the reverse: clock out on A, kiosk B drops them from "On the clock"
  // without any manual reload.
  await kioskA
    .locator(".k-here")
    .getByText(STUDENT_NAME, { exact: true })
    .click();
  await expect(kioskA.getByText(`Signed out ${STUDENT_NAME}`)).toBeVisible();

  await expect(
    kioskB.locator(".k-here").getByText(STUDENT_NAME, { exact: true }),
  ).not.toBeVisible({ timeout: 15_000 });
  // Back in the sign-in grid on B, still with no reload of its own.
  await expect(
    kioskB.getByRole("button", { name: STUDENT_NAME, exact: true }),
  ).toBeVisible();

  await contextA.close();
  await contextB.close();
});
