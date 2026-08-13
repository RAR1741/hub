import { request } from "@playwright/test";

// Local runs hit the webpack **dev** server (no `webServer` block here — see
// the comment in playwright.config.ts), which compiles each route lazily on
// its first request. Under parallel-ish load that first compile can take
// longer than a test's timeout, so whichever spec happens to hit a given
// route first flakes — a different one each run. CI doesn't have this
// problem (it builds + `next start`s a prod server first), so this is a
// local-only annoyance, but it's worth curing here too since it costs
// nothing when the server is already warm.
//
// Fix: before the suite runs, GET every route the specs exercise so webpack
// compiles them all up front. Tolerant of everything — some of these
// redirect (guest hitting an authed route) or 404/403; a request still
// reaches the route handler and triggers compilation either way. This is
// intentionally NOT a `webServer` block: that would force a fresh
// build/start every run, which is too slow for local iteration. Warming an
// already-running dev server is the lighter fix.
const ROUTES = [
  "/",
  "/login",
  "/kiosk",
  "/leaderboard",
  "/calendar",
  "/me/attendance",
  "/teams",
  "/people",
  "/admin",
  "/admin/requests",
  "/admin/sessions/flagged",
  "/admin/people",
  "/admin/settings",
  "/admin/reports",
  "/api/whos-here",
];

export default async function globalSetup(): Promise<void> {
  // Mirrors the `use.baseURL` default in playwright.config.ts.
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const ctx = await request.newContext({ baseURL });
  await Promise.all(
    ROUTES.map((route) =>
      ctx.get(route, { timeout: 30_000 }).catch(() => {
        // Ignore failures — the goal is only to trigger compilation. A
        // route that's slow/erroring here will just compile on its first
        // real hit in a test instead, same as without this file.
      }),
    ),
  );
  await ctx.dispose();
}
