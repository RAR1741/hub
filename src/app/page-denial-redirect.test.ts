import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/**
 * Denial-destination guardrail (#286).
 *
 * A signed-in viewer who fails a page's gate must not be sent to /login: they
 * are already signed in, so the sign-in form just loops back to the denial.
 * Role gates use `requirePageRole` (src/lib/authz.ts), which sends guests to
 * /login and signed-in viewers home; the remaining `!viewer.person` gates
 * redirect to "/" or "/login" via their own line, and only /login itself may
 * name /login as a destination.
 *
 * This fails on any NEW `redirect("/login")` copy-pasted into a page.
 */

const appDir = path.dirname(fileURLToPath(import.meta.url));

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return pageFiles(full);
    return e.isFile() && e.name === "page.tsx" ? [full] : [];
  });
}

// The four `!viewer.person` pages keep bouncing person-less viewers to /login
// (see #286 — a signed-in account with no roster row genuinely needs to sign in
// as a real member). Everything else must use requirePageRole.
const PERSON_GATE_ALLOWLIST = new Set([
  "events/page.tsx",
  "events/[id]/page.tsx",
  "me/attendance/page.tsx",
  "me/notifications/page.tsx",
]);

test("no page redirects a denied viewer to /login", () => {
  const offenders = pageFiles(appDir)
    .filter((f) => readFileSync(f, "utf8").includes('redirect("/login")'))
    .map((f) => path.relative(appDir, f).split(path.sep).join("/"))
    .filter((rel) => !PERSON_GATE_ALLOWLIST.has(rel));

  expect(offenders).toEqual([]);
});
