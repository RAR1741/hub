import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Route authorization guardrail (security audit #251, item 2).
 *
 * The whole app talks to Supabase through a single service-role client
 * (`getDb()`), which BYPASSES RLS by design — there are zero RLS policies, so
 * there is no database-layer authorization backstop. Every access decision is
 * made in application code. The blessed way to gate a route handler is the
 * `withRole(...)` wrapper (src/lib/api.ts), which resolves the viewer, enforces
 * the required role, and blocks mutations while masquerading.
 *
 * This test makes the set of routes that do NOT use `withRole` explicit and
 * reviewed: each such route must appear in ROUTE_AUTH_ALLOWLIST below with a
 * one-line note describing how it is actually protected (bespoke gate, public
 * by design, dev-only, etc.). A NEW route added without `withRole` fails this
 * test until a human either gates it with `withRole` or adds a justified
 * allowlist entry — forcing a deliberate, reviewed decision rather than an
 * unnoticed exposure of the RLS-bypassing client.
 *
 * This is a scrutiny tripwire, not a proof of correct authorization: an
 * allowlisted route still relies on its documented gate being correct. Keep the
 * `protection` note accurate — it is the reviewer's map of every non-standard
 * route and why it is safe.
 */

// Keyed by the route file's path relative to src/app (forward slashes).
const ROUTE_AUTH_ALLOWLIST: Record<string, string> = {
  // --- Public by design (unauthenticated, rate-limited) -------------------
  "api/account-request/route.ts":
    "Public new-account request form; per-IP rate limited; only inserts to account_request.",
  "api/auth/otp/request/route.ts":
    "Public login step; per-IP and per-email rate limited; emails a one-time code.",
  "api/auth/otp/verify/route.ts":
    "Public login step; per-IP rate limited; verifies the OTP and mints a session.",
  "api/whos-here/route.ts":
    "Guests allowed; returns only roster-scope names + arrival time (no contact detail).",
  "api/auth/logout/route.ts":
    "Public; clears the session cookie and redirects. No DB access, no privileged action.",

  // --- Authenticated, but gated manually (getViewer, not withRole) --------
  "api/whoami/route.ts":
    "Any viewer; returns only the caller's own role/name.",
  "api/events/[id]/signup/route.ts":
    "getViewer() + per-IP rate limit; the viewer acts only on their own signup.",
  "api/excusal-requests/route.ts":
    "getViewer() + per-IP rate limit; the viewer files their own excusal request.",
  "api/realtime-token/route.ts":
    "Registered kiosk cookie or any non-guest viewer; mints a short-lived realtime token.",
  "api/admin/masquerade/exit/route.ts":
    "Any viewer; only clears the caller's own masquerade cookie/session (no privilege gained).",
  "api/admin/first/session/route.ts":
    "getViewer() + hasRole('admin') gate.",
  "api/admin/first/link/route.ts":
    "getViewer() + hasRole('admin') gate.",
  "api/admin/slack/link-sync/route.ts":
    "getViewer() + hasRole('admin') gate.",
  "api/github/oauth/start/route.ts":
    "getViewer() + hasRole('student'); redirects the signed-in user to GitHub.",
  "api/onshape/oauth/start/route.ts":
    "getViewer() + hasRole('student'); redirects the signed-in user to Onshape.",

  // --- OAuth callbacks (viewer/email + single-use state cookie for CSRF) --
  "auth/callback/route.ts":
    "Public OAuth landing; exchanges the PKCE code and links/bootstraps by the verified Google email.",
  "api/github/oauth/callback/route.ts":
    "getViewer() + hasRole('student') + single-use OAuth state cookie (CSRF).",
  "api/onshape/oauth/callback/route.ts":
    "getViewer() + hasRole('student') + single-use OAuth state cookie (CSRF).",

  // --- Shared-secret gates (server-to-server sync / cron) -----------------
  "api/cron/slack/event-channels/route.ts":
    "x-sync-secret compared in constant time (secureEqual); fails closed when unset.",
  "api/cron/slack/mentor-reminders/route.ts":
    "x-sync-secret compared in constant time (secureEqual); fails closed when unset.",
  "api/cron/slack/whats-new/route.ts":
    "x-sync-secret compared in constant time (secureEqual); fails closed when unset.",
  "api/cron/push/clocked-in-late/route.ts":
    "x-sync-secret compared in constant time (secureEqual); fails closed when unset.",
  "api/cron/push/meeting-reminder/route.ts":
    "x-sync-secret compared in constant time (secureEqual); fails closed when unset.",
  "api/admin/first/sync/route.ts":
    "x-sync-secret (constant time) OR getViewer()+hasRole('admin').",
  "api/admin/github-team/sync/route.ts":
    "x-sync-secret (constant time) OR getViewer()+hasRole('mentor').",
  "api/admin/drive-group/sync/route.ts":
    "x-sync-secret (constant time) OR getViewer()+hasRole('mentor').",
  "api/admin/calendar/sync/route.ts":
    "x-sync-secret (constant time) OR getViewer()+hasRole('mentor').",

  // --- Kiosk (registered-device token) ------------------------------------
  "api/kiosk/clock-in/route.ts":
    "kioskActionAllowed() (registered kiosk token or admin) + rate limit.",
  "api/kiosk/clock-out/route.ts":
    "kioskActionAllowed() (registered kiosk token or admin) + rate limit.",
  "api/kiosk/setup/route.ts":
    "verifyKioskToken() (registered kiosk token) + rate limit.",

  // --- Dev/e2e only (disabled in production) ------------------------------
  "api/auth/dev-login/route.ts":
    "Dev/e2e convenience; returns 404 in production (NODE_ENV guard).",
  "api/auth/student/route.ts":
    "Low-entropy student-ID login; per-IP rate limited. Being disabled in production, see #251.",
  "api/dev/onshape-mock/oauth/token/route.ts":
    "Dev/e2e Onshape mock; blocked by onshapeMockBlocked() outside local/CI.",
  "api/dev/onshape-mock/v6/parts/d/[did]/[wvm]/[wvmId]/route.ts":
    "Dev/e2e Onshape mock; blocked by onshapeMockBlocked() outside local/CI.",
};

const APP_DIR = fileURLToPath(new URL("./", import.meta.url));
// A route handler is considered "gated by the standard wrapper" only when it
// actually exports a handler wrapped in withRole, i.e. the established
// `export const <METHOD> = withRole(...)` / `withRole<...>(...)` form (verified
// to be the only shape used across the codebase). Anchoring to the export
// statement — rather than matching `withRole` anywhere — keeps a mere mention
// in a comment or string from silently marking a route as gated. Every other
// gating mechanism must be documented in the allowlist above.
const WITH_ROLE = /^\s*export\s+const\s+[A-Z]+\s*=\s*withRole\s*[<(]/m;

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findRouteFiles(full));
    } else if (entry.name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

function relKey(full: string): string {
  return path.relative(APP_DIR, full).split(path.sep).join("/");
}

const routeFiles = findRouteFiles(APP_DIR);

describe("route authorization guardrail (#251 item 2)", () => {
  test("finds route handlers to check", () => {
    // Sanity: if this drops to zero the walker is broken and the guardrail is
    // silently passing.
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  test("every non-withRole route is documented in ROUTE_AUTH_ALLOWLIST", () => {
    const undocumented: string[] = [];
    for (const full of routeFiles) {
      const src = readFileSync(full, "utf8");
      const key = relKey(full);
      if (WITH_ROLE.test(src)) continue; // gated by the standard wrapper
      if (!(key in ROUTE_AUTH_ALLOWLIST)) undocumented.push(key);
    }
    expect(
      undocumented,
      `These routes reach the service-role DB pattern without the withRole() gate and are ` +
        `not documented. Gate each with withRole(), or add an entry to ROUTE_AUTH_ALLOWLIST ` +
        `describing how it is protected:\n  ${undocumented.join("\n  ")}`,
    ).toEqual([]);
  });

  test("allowlist entries are gate-free, present, and documented (no stale entries)", () => {
    const gatedButListed: string[] = [];
    const missing: string[] = [];
    const emptyReason: string[] = [];
    const present = new Map(routeFiles.map((f) => [relKey(f), f]));

    for (const [key, protection] of Object.entries(ROUTE_AUTH_ALLOWLIST)) {
      const full = present.get(key);
      if (!full) {
        missing.push(key);
        continue;
      }
      if (!protection.trim()) emptyReason.push(key);
      if (WITH_ROLE.test(readFileSync(full, "utf8"))) gatedButListed.push(key);
    }

    expect(
      missing,
      `Allowlist references routes that no longer exist — remove them:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
    expect(
      gatedButListed,
      `These routes now use withRole() and no longer need an allowlist entry — remove them:\n  ${gatedButListed.join("\n  ")}`,
    ).toEqual([]);
    expect(
      emptyReason,
      `Every allowlist entry needs a non-empty protection note:\n  ${emptyReason.join("\n  ")}`,
    ).toEqual([]);
  });
});
