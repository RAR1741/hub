# FIRST Roster Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync mentors' Consent & Release, YPP screening, and YPP training statuses from my.firstinspires.org into the hub (nightly + Sync Now), shown on an admin dashboard and each person's page.

**Architecture:** A pure-ish sync engine (`src/lib/first-sync.ts`) fetches the FIRST roster page + status JSON by replaying an admin-pasted session cookie (`src/lib/first-auth.ts`; automated login proved infeasible — the FIRST admin account is a bot-walled personal Microsoft account, see spec), matches FIRST people to `person` rows (first_people_id → email → nameKey), updates status columns on `person`, and persists a report. An admin pastes the FIRST session cookie into a dashboard card (validated on save); the nightly cron + data fetch/parse/match are automated. One API route runs the sync (admin session or `x-sync-secret` for pg_cron), a PATCH route backs manual linking, a session route stores the cookie, and two UI surfaces render the data.

**Tech Stack:** Next.js App Router, Supabase (service-role via `getDb()`), vitest, Playwright e2e, pg_cron + pg_net.

**Spec:** `docs/superpowers/specs/2026-08-26-first-roster-sync-design.md` (read it first — it contains the captured endpoint shapes and gotchas).

## Global Constraints

- Work in the `first-roster-sync` worktree (`.worktrees/first-roster-sync`). All commands run in the container: `./dev npm run test`, `./dev npm run typecheck`, etc. Never run node/npm on the host.
- Commit after every task and push immediately (`git push`). Commits are GPG-signed; if signing fails with "keyboxd not running", commit from PowerShell after `& "C:\Program Files (x86)\GnuPG\bin\gpg-connect-agent.exe" /bye`.
- No FIRST username/password anywhere (automated login is out — see spec). Auth is a manually-pasted session **Cookie header**, stored in `app_setting.first_session` and replayed. The cookie value is sensitive: NEVER log it, echo it in responses, or put it in fixtures/tests. `FIRST_USERNAME`/`FIRST_PASSWORD` are unused by v1.
- `GetPersonStatus` requires REPEATED `&ids=N&ids=M` params — comma-separated silently returns `[]`.
- FIRST people can hold multiple roles: always dedupe by `peopleId` (32 role entries → 29 unique adults on team 1741). Merge `ConsentReleaseStatus` as any-true.
- Adults = `role_category` ∈ {`Primary Team Contacts`, `Additional Team Contacts`}. Everything else (youth) is out of scope for v1.
- Never auto-create `person` rows from FIRST data.
- Migrations: new files only, never edit applied ones. New tables aren't needed; columns on `person` need no new grants (`person` already has service_role grants).
- Do not run graphify during implementation tasks; run `graphify update .` once at the end.

---

### Task 1: Cookie-based FIRST session → rework `first-auth.ts`

Automated login was ruled out (spike commit `f73f8bb`: the FIRST admin account is a bot-walled personal Microsoft account — see spec §Authentication). This task reworks the existing `src/lib/first-auth.ts` to the manual-cookie model: store a pasted `Cookie:` header, replay it, detect expiry. NOT a gate — proceed to Task 2 when the live check passes.

The current `first-auth.ts` (from the spike) has a `CookieJar` + `loginToFirst` + a jar-based `fetchWithSession`. Replace the login/jar machinery with the cookie-string model below. Keep the git history; just rewrite the file's exports.

**Files:**
- Modify: `src/lib/first-auth.ts` (replace login/jar exports with the cookie model)
- Create: `src/lib/first-auth.test.ts` (unit test the pure normalizer)
- Modify: `scripts/check-first-login.mjs` (live check against a pasted cookie)
- Modify: `.env.example` (remove FIRST_USERNAME/FIRST_PASSWORD; they're unused)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/first-auth.ts
  /**
   * Normalize a pasted Cookie header: strip an optional leading "Cookie:" label,
   * trim, collapse internal newlines/whitespace to single spaces. PURE.
   */
  export function normalizeCookieHeader(pasted: string): string;
  /**
   * GET a my.firstinspires.org URL replaying `cookie` (a raw Cookie header).
   * redirect: "manual". 200 → { kind: "ok", body }. A 3xx whose Location contains
   * "firstcommunity.firstinspires.org" or "/Login" → { kind: "auth" } (expired).
   * Any other status → throw Error("first-auth: roster fetch returned <status>").
   */
  export async function fetchWithSession(
    url: string,
    cookie: string,
    fetchFn?: typeof fetch,
  ): Promise<{ kind: "ok"; body: string } | { kind: "auth" }>;
  ```
  Remove `CookieJar`, `cookieHeader`, `storeSetCookies`, `loginToFirst` (dead under the cookie model). `fetchWithSession` never logs the cookie value.

- [ ] **Step 1: Write the failing normalizer test** in `src/lib/first-auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeCookieHeader } from "./first-auth";

describe("normalizeCookieHeader", () => {
  it("strips a leading Cookie: label and trims", () => {
    expect(normalizeCookieHeader("Cookie: a=1; b=2")).toBe("a=1; b=2");
    expect(normalizeCookieHeader("  cookie:  a=1; b=2  ")).toBe("a=1; b=2");
  });
  it("collapses embedded newlines/whitespace to single spaces", () => {
    expect(normalizeCookieHeader("a=1;\n  b=2")).toBe("a=1; b=2");
  });
  it("leaves a plain header unchanged", () => {
    expect(normalizeCookieHeader("a=1; b=2")).toBe("a=1; b=2");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**: `./dev npx vitest run src/lib/first-auth.test.ts`. Expected: FAIL (export missing / old API).

- [ ] **Step 3: Rewrite `src/lib/first-auth.ts`** to the interface above. `normalizeCookieHeader` is pure string work. `fetchWithSession` does one `fetch(url, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" }, redirect: "manual" })` and classifies the response per the contract (200 ok / auth-redirect / throw). Never log the cookie.

- [ ] **Step 4: Run tests + gates**: `./dev npx vitest run src/lib/first-auth.test.ts`, then `./dev npm run typecheck` and `./dev npm run lint`. Expected: pass/clean.

- [ ] **Step 5: Rewrite `scripts/check-first-login.mjs`** — live check that reads a pasted cookie from the `FIRST_COOKIE` env var (so no cookie is ever committed):

```js
// Manual live check: paste a fresh Cookie header into FIRST_COOKIE, then:
//   ./dev bash -lc 'FIRST_COOKIE="<paste>" npx tsx scripts/check-first-login.mjs'
// Not run in CI (CI can't reach FIRST).
import { fetchWithSession, normalizeCookieHeader } from "../src/lib/first-auth.ts";

const cookie = normalizeCookieHeader(process.env.FIRST_COOKIE ?? "");
if (!cookie) throw new Error("Set FIRST_COOKIE to a pasted my.firstinspires.org Cookie header");

const res = await fetchWithSession(
  "https://my.firstinspires.org/Teams/Page/TeamContacts/TeamRoster?TeamProfileID=1790765",
  cookie,
);
if (res.kind !== "ok") throw new Error("session did not authenticate (cookie expired?)");
if (!res.body.includes("teamContactsModel")) throw new Error("roster model missing from page");
console.log("OK: cookie authenticated, roster page fetched,", res.body.length, "bytes");
```

- [ ] **Step 6: Run the live check** with a cookie you copy from your browser (DevTools → Network → a my.firstinspires.org request → Request Headers → Cookie): `./dev bash -lc 'FIRST_COOKIE="<paste>" npx tsx scripts/check-first-login.mjs'`. Expected: `OK: cookie authenticated, ...`. (If tsx isn't present: `./dev npm i -D tsx` first, note it in the report.) This confirms the replay path end-to-end; it is not a CI test.

- [ ] **Step 7: Trim `.env.example`** — remove the `FIRST_USERNAME`/`FIRST_PASSWORD` lines added by the spike (unused now). No FIRST secrets belong in env.

- [ ] **Step 8: Commit + push**

```bash
git add src/lib/first-auth.ts src/lib/first-auth.test.ts scripts/check-first-login.mjs .env.example package.json package-lock.json
git commit -m "feat(first-sync): cookie-based FIRST session (replaces automated login)"
git push
```

---

### Task 2: Migration + types

**Files:**
- Create: `supabase/migrations/<timestamp>_first_roster_sync.sql` (generate timestamp: `date +%Y%m%d%H%M%S` UTC)
- Modify: `src/lib/types.ts` (PersonRow, Person, personFromRow)

**Interfaces:**
- Produces: `person` columns `first_people_id`, `first_consent_release`, `first_screening_status`, `first_screening_text`, `first_training_status`, `first_synced_at`; app_setting keys `first_team_profile_id`, `first_sync_secret`, `first_sync_url`, `first_session`, `first_last_sync_report`. TS fields `firstPeopleId`, `firstConsentRelease`, `firstScreeningStatus`, `firstScreeningText`, `firstTrainingStatus`, `firstSyncedAt` on `Person`.

- [ ] **Step 1: Write the migration**

```sql
-- FIRST roster sync (v1: mentors). Status columns live on person; current
-- standing only, no history. Raw values as FIRST reports them.
alter table person
  add column first_people_id integer unique,
  add column first_consent_release boolean,
  add column first_screening_status text,
  add column first_screening_text text,
  add column first_training_status text,
  add column first_synced_at timestamptz;

insert into app_setting (key, value) values
  ('first_team_profile_id', '1790765'),
  -- Set per-env; empty never authorizes the cron header (see sync route).
  ('first_sync_secret', '""'),
  -- Locally the app runs on the host-mapped port; set to the prod URL on the hosted project.
  ('first_sync_url', '"http://host.docker.internal:3000/api/admin/first/sync"'),
  ('first_session', 'null'),
  ('first_last_sync_report', 'null')
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply locally**: `./dev npm run db:reset`. Expected: completes without error.

- [ ] **Step 3: Extend types** in `src/lib/types.ts`. Add to `PersonRow` (optional, matching the existing optional-column style):

```ts
  first_people_id?: number | null;
  first_consent_release?: boolean | null;
  first_screening_status?: string | null;
  first_screening_text?: string | null;
  first_training_status?: string | null;
  first_synced_at?: string | null;
```

Add to `Person`: `firstPeopleId: number | null; firstConsentRelease: boolean | null; firstScreeningStatus: string | null; firstScreeningText: string | null; firstTrainingStatus: string | null; firstSyncedAt: string | null;` and map them in `personFromRow` with `?? null`.

- [ ] **Step 4: Run `./dev npm run typecheck` and `./dev npm run test`.** Expected: clean (existing tests unaffected).

- [ ] **Step 5: Commit + push**

```bash
git add supabase/migrations/*_first_roster_sync.sql src/lib/types.ts
git commit -m "feat(first-sync): person status columns + settings seeds"
git push
```

---

### Task 3: Sync engine + unit tests

**Files:**
- Create: `src/lib/first-sync.ts`
- Test: `src/lib/first-sync.test.ts`

**Interfaces:**
- Consumes: `fetchWithSession` from `./first-auth` (Task 1); `nameKey` from `./name-match`; `getSetting` from `./settings`.
- Produces:
  ```ts
  export type FirstPerson = {
    peopleId: number;
    firstName: string;   // name_first
    lastName: string;    // name_last
    email: string;       // lowercased
    consentRelease: boolean;           // any-true across role entries
    screeningStatus: string | null;    // e.g. "green" | "blue" | "orange"
    screeningText: string | null;
    trainingStatus: string | null;
  };
  export type FirstSyncReport = {
    ranAt: string; // ISO
    rosterCount: number;   // unique adults on the FIRST roster
    matched: number;
    updated: number;
    unmatchedFirst: { peopleId: number; name: string; email: string }[];
    unmatchedHub: { personId: string; name: string }[];
  };
  // PURE helpers (exported for tests):
  export function parseTeamContactsModel(html: string): unknown;   // throws if not found
  export function adultsFromModel(model: unknown): FirstPerson[];  // filter+dedupe+merge, no statuses yet
  export function statusUrl(teamProfileId: string, ids: number[]): string; // repeated &ids=
  export type HubCandidate = { personId: string; name: string; firstName: string; lastName: string; firstPeopleId: number | null; emails: string[] };
  export function matchFirstToHub(first: FirstPerson[], hub: HubCandidate[]): { pairs: { first: FirstPerson; personId: string }[]; unmatchedFirst: FirstPerson[] };
  // Orchestrator:
  export async function syncFirstRoster(deps: { db: SupabaseClient; fetchFn?: typeof fetch }): Promise<FirstSyncReport>;
  ```

Implementation notes for `syncFirstRoster`:
1. Read settings: `first_team_profile_id` (string or number — normalize to string), `first_session` (as `{ cookie: string; savedAt: string } | null`).
2. If `first_session` is null → throw `Error("first_not_configured")`. Else `fetchWithSession(rosterUrl, first_session.cookie)`; on `{kind:"auth"}` → throw `Error("first_session_expired")` (no automated re-login under the cookie model; the admin must re-paste). No retry.
3. `parseTeamContactsModel`: locate the `teamContactsModel` assignment in the HTML — find the marker `teamContactsModel`, then the first `{` after the `=`, then brace-count (respecting strings) to the matching `}` and `JSON.parse` the slice. Throws with a clear message when the marker is absent.
4. `adultsFromModel`: read `PeopleRoles` array; keep entries whose `role_category` is `"Primary Team Contacts"` or `"Additional Team Contacts"`; group by `peopleId`; merge consent any-true; take first-seen non-empty name/email; lowercase email.
5. Fetch `statusUrl(...)` via `fetchWithSession(statusUrl, first_session.cookie)` (a mid-run `{kind:"auth"}` here also throws `first_session_expired`); parse JSON array; fold `screening.status/.text` and `training.status` into the `FirstPerson`s by `peopleId` (missing entry → statuses stay null).
6. Build `HubCandidate`s: `person` rows where `role in ('mentor','admin')` (all of them — inactive too, so a returning mentor keeps their link), plus `person_identity.email` list per person (query `person_identity` separately, group in JS).
7. `matchFirstToHub` ladder, first match wins, each hub person claimable once: (a) `firstPeopleId` equal; (b) email ∈ candidate.emails (all lowercased); (c) `nameKey(first.firstName, first.lastName) === nameKey(candidate.firstName, candidate.lastName)`.
8. Update each matched `person`: the 5 status columns + `first_people_id` + `first_synced_at = ranAt`. Check `error` on every write; collect count.
9. `unmatchedHub` = ACTIVE mentors/admins with no `first_people_id` after this run. Write report to `app_setting.first_last_sync_report` (upsert). Return it.

- [ ] **Step 1: Write fixtures + failing tests** in `src/lib/first-sync.test.ts`. Use this sanitized fixture (shape captured live 2026-08-26; names/emails fake):

```ts
const MODEL = {
  PeopleRoles: [
    { peopleId: 101, name_first: "Alice", name_last: "Anderson", email: "ALICE@example.org", phone: "555-0001", role_category: "Primary Team Contacts", role_key: "coach-1", ConsentReleaseStatus: true },
    { peopleId: 101, name_first: "Alice", name_last: "Anderson", email: "alice@example.org", phone: "555-0001", role_category: "Additional Team Contacts", role_key: "Mentor", ConsentReleaseStatus: false },
    { peopleId: 102, name_first: "Bob", name_last: "Baker", email: "bob@example.org", phone: "555-0002", role_category: "Additional Team Contacts", role_key: "Mentor", ConsentReleaseStatus: false },
    { peopleId: 201, name_first: "Kid", name_last: "Kiddo", email: "kid@example.org", phone: "", role_category: "Youth Team Members", role_key: "youth", ConsentReleaseStatus: false },
  ],
};
const HTML = `<html><script>var x=1; window.teamContactsModel = ${JSON.stringify(MODEL)};</script></html>`;
const STATUS = [
  { peopleId: 101, screening: { status: "green", text: "Meets Youth Protection Policy Requirements", icon: "glyphicon-ok" }, supplemental: { status: "grey", text: "", stateprov: "IN" }, training: { status: "green", icon: "glyphicon-ok" } },
  { peopleId: 102, screening: { status: "blue", text: "This person has not yet agreed to the Youth Protection Policy for the current season", icon: "x" }, supplemental: { status: "grey", text: "", stateprov: "IN" }, training: { status: "blue", icon: "x" } },
];
```

Test cases (vitest, mirror the describe/it style of `src/lib/drive-group-sync.test.ts`):
- `parseTeamContactsModel(HTML)` returns an object whose `PeopleRoles` has 4 entries; throws on HTML without the marker.
- `adultsFromModel` returns 2 people (youth filtered, 101 deduped), `consentRelease === true` for 101 (any-true), `false` for 102, email lowercased to `alice@example.org`.
- `statusUrl("1790765", [101, 102])` equals `https://my.firstinspires.org/Teams/Page/TeamContacts/GetPersonStatus?TeamProfileID=1790765&ids=101&ids=102` (REPEATED ids — this test guards the captured gotcha).
- `matchFirstToHub` ladder: matches by existing firstPeopleId even when email differs; else by any identity email case-insensitively; else by nameKey; unmatched FIRST people land in `unmatchedFirst`; a hub person already claimed by firstPeopleId isn't re-claimed by a later email match.

- [ ] **Step 2: Run tests, verify they fail**: `./dev npx vitest run src/lib/first-sync.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/first-sync.ts`** per the notes above. Pure helpers first, then the orchestrator (orchestrator is exercised in e2e/live, not unit tests — don't mock supabase in unit tests here; keep the pure functions pure).

- [ ] **Step 4: Run tests, verify they pass**: `./dev npx vitest run src/lib/first-sync.test.ts`. Then the full gates: `./dev npm run test`, `./dev npm run typecheck`, `./dev npm run lint`. Expected: all pass.

- [ ] **Step 5: Commit + push**

```bash
git add src/lib/first-sync.ts src/lib/first-sync.test.ts
git commit -m "feat(first-sync): sync engine — parse, dedupe, match ladder, report"
git push
```

---

### Task 4: Sync + link + session API routes, cron migration

**Files:**
- Create: `src/app/api/admin/first/sync/route.ts`
- Create: `src/app/api/admin/first/link/route.ts`
- Create: `src/app/api/admin/first/session/route.ts`
- Create: `supabase/migrations/<timestamp>_first_sync_cron.sql`

**Interfaces:**
- Consumes: `syncFirstRoster` (Task 3), `fetchWithSession` + `normalizeCookieHeader` (Task 1), `getSetting`, `getDb`, `getViewer`, `hasRole`, `secureEqual` (`src/lib/secure-compare`).
- Produces: `POST /api/admin/first/sync` → `FirstSyncReport` JSON | `{error}`; `PATCH /api/admin/first/link` body `{ personId: string, firstPeopleId: number | null }` → `{ok: true}`; `POST /api/admin/first/session` body `{ cookie: string }` → `{ok: true}` | 400 `{error:"invalid_session"}`.

- [ ] **Step 1: Write the sync route** — clone the dual-auth shape of `src/app/api/admin/calendar/sync/route.ts` exactly, with these differences: setting key `first_sync_secret`, session gate `hasRole(viewer.role, "admin")` (admin, not mentor — spec: non-admin mentors can't see others' status). No env check (no FIRST env vars in the cookie model); the "session not configured / expired" cases surface as thrown errors from `syncFirstRoster`, mapped to clear responses:

```ts
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { secureEqual } from "@/lib/secure-compare";
import { syncFirstRoster } from "@/lib/first-sync";

export async function POST(request: Request) {
  const db = getDb();

  // Gate 1: shared secret (for pg_cron, which has no session). Empty secret never authorizes.
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("first_sync_secret", "", db);
  const secretOk = secret.length > 0 && provided != null && secureEqual(provided, secret);

  // Gate 2: an admin session.
  if (!secretOk) {
    const viewer = await getViewer();
    if (!hasRole(viewer.role, "admin")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  try {
    const report = await syncFirstRoster({ db });
    return Response.json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish the two admin-actionable states from a generic failure.
    if (msg === "first_not_configured") {
      return Response.json({ error: "not_configured" }, { status: 400 });
    }
    if (msg === "first_session_expired") {
      return Response.json({ error: "session_expired" }, { status: 400 });
    }
    console.error("first sync failed:", e); // never logs the cookie
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Write the link route** (`src/app/api/admin/first/link/route.ts`): admin-only (same viewer gate, no secret path). Validate body: `personId` non-empty string, `firstPeopleId` integer or null → else 400 `{error:"bad_request"}`. Update: `db.from("person").update({ first_people_id: firstPeopleId }).eq("id", personId)`; check `error` (unique violation on an already-linked id → 409 `{error:"already_linked"}`, code `23505`); return `{ok:true}`.

- [ ] **Step 3: Write the session route** (`src/app/api/admin/first/session/route.ts`): admin-only (same viewer gate, no secret path). Body `{ cookie: string }`. Steps:
  1. `const cookie = normalizeCookieHeader(String(body?.cookie ?? ""))`; empty → 400 `{error:"bad_request"}`.
  2. Validate live: read `first_team_profile_id` from settings, build the roster URL, `const res = await fetchWithSession(rosterUrl, cookie)`. If `res.kind !== "ok"` or `!res.body.includes("teamContactsModel")` → 400 `{error:"invalid_session"}` and store nothing. Wrap the fetch in try/catch → also `invalid_session` on throw.
  3. On success: `db.from("app_setting").upsert({ key: "first_session", value: { cookie, savedAt: new Date().toISOString() } })`; check `error`; return `{ok:true}`.
  Never log or echo the cookie value in any response.

- [ ] **Step 4: Write the cron migration** — clone `supabase/migrations/20260811084653_calendar_cron.sql`, job name `first-nightly-sync`, schedule `0 8 * * *`, URL setting `first_sync_url`, secret setting `first_sync_secret`. (The URL/secret seeds already exist from Task 2 — this migration only adds the `cron.schedule` call.)

- [ ] **Step 5: Apply + verify**: `./dev npm run db:reset`, then with the stack running, exercise the route with the secret header:

```bash
./dev bash -lc 'curl -s -X POST -H "x-sync-secret: wrong" localhost:3000/api/admin/first/sync'
```

Expected: `{"error":"forbidden"}` (secret is empty in DB, header wrong → falls to session gate → guest → 403). For a full authorized run: paste a real cookie via the session route (once Task 5's UI exists, or by curl with an admin cookie) — otherwise the e2e task covers the authorized path with seeded data.

- [ ] **Step 6: Run `./dev npm run typecheck`, `./dev npm run lint`, `./dev npm run test`.** Expected: clean.

- [ ] **Step 7: Commit + push**

```bash
git add src/app/api/admin/first supabase/migrations/*_first_sync_cron.sql
git commit -m "feat(first-sync): sync + link + session routes, nightly cron"
git push
```

---

### Task 5: Admin dashboard `/admin/first-status`

**Files:**
- Create: `src/app/admin/first-status/page.tsx` (server component)
- Create: `src/components/FirstStatusTable.tsx` (client: sortable table)
- Create: `src/components/FirstSyncPanel.tsx` (client: Sync Now)
- Create: `src/components/FirstLinkPicker.tsx` (client: link unmatched FIRST entry to a person)
- Create: `src/components/FirstSessionCard.tsx` (client: paste + save session cookie)
- Modify: `src/app/admin/page.tsx` (add a nav card/link to `/admin/first-status`, matching how other admin tools are listed there)

**Interfaces:**
- Consumes: `FirstSyncReport` from `@/lib/first-sync`; `getSetting`; `listPeople(undefined, db)`; `displayName` from `@/lib/people`; `POST /api/admin/first/sync`; `PATCH /api/admin/first/link`; `POST /api/admin/first/session`.
- Produces: `FirstStatusTable({ rows })` where `rows: { personId: string; name: string; consent: boolean | null; screeningStatus: string | null; screeningText: string | null; trainingStatus: string | null; syncedAt: string | null }[]`.

Badge mapping (one shared helper inside `FirstStatusTable.tsx`, exported for reuse by the person-page card):

```tsx
export function StatusBadge({ status, label }: { status: string | null; label?: string }) {
  // FIRST's colors: green = complete, orange = in progress (vendor), blue = action
  // needed, grey/unknown = no data. Consent booleans map to green/blue by the caller.
  const cls =
    status === "green" ? "pill on" :
    status === "orange" ? "pill role" :
    status === "blue" ? "pill off" :
    "pill";
  const text =
    label ?? (status === "green" ? "Complete" : status === "orange" ? "In progress" : status === "blue" ? "Action needed" : "—");
  return <span className={cls}>{text}</span>;
}
```

(Verify the `pill on/off/role/admin` classes render distinct colors — they're the existing pills used on the person page; adjust to whatever reads clearly, don't invent a new design system.)

- [ ] **Step 1: Page server component.** Gate: `getViewer()` → `if (!hasRole(viewer.role, "admin")) redirect("/")` (same as drive-sync page). Load `listPeople(undefined, db)` filtered to `role !== "student" && is_active`, plus `getSetting<FirstSyncReport | null>("first_last_sync_report", null, db)` and `getSetting<{ cookie: string; savedAt: string } | null>("first_session", null, db)`. Render:
  1. Page head: title "FIRST roster status", sub showing `first_synced_at`-style "Last synced …" from the report's `ranAt` (or "never").
  2. `<FirstSessionCard savedAt={session?.savedAt ?? null} />` in a card (do NOT pass the cookie value to the client — only whether/when one is saved).
  3. `<FirstSyncPanel />` in a card.
  4. `<FirstStatusTable rows={...} />` in a card — one row per active mentor/admin from `person` (statuses straight off the row columns; people with no `first_people_id` still get a row with a "Not linked" pill in the consent column area).
  5. "Unmatched FIRST roster entries" card: from `report.unmatchedFirst`, each row name + email + `<FirstLinkPicker firstPeopleId={...} people={peoplePicker} />` where `peoplePicker` is the same `{id, name}` list pattern as the drive-sync page. Empty state: "Everything on the FIRST roster is linked."

- [ ] **Step 2: `FirstSessionCard.tsx`** — client component. Props: `{ savedAt: string | null }`. Shows session state: if `savedAt`, "FIRST session saved <relative/local time>. Re-paste when sync reports it expired." else "No FIRST session saved — paste one to enable syncing." A `<textarea>` for the Cookie header + a Save button that POSTs `/api/admin/first/session` with `{ cookie }`; on `{ok}` → `router.refresh()` + "Session saved."; on 400 `invalid_session` → "That cookie didn't authenticate — copy a fresh one and try again."; other errors inline (DriveSyncPanel outcome-state pattern). Include brief copy instructions as helper text: "In your browser, log into my.firstinspires.org, open DevTools → Network, click any my.firstinspires.org request, and copy the entire value of the request's Cookie header." Never render the stored cookie.

- [ ] **Step 3: `FirstSyncPanel.tsx`** — clone `src/components/DriveSyncPanel.tsx` verbatim, changing: endpoint `/api/admin/first/sync`, ok-state message `Synced — {matched} matched, {updated} updated, {unmatchedFirst.length} unmatched.` (read those fields off the response body). Error state: map `{error:"session_expired"}` → "FIRST session expired — re-paste the cookie above." and `{error:"not_configured"}` → "No FIRST session saved yet — paste the cookie above." else show the message.

- [ ] **Step 4: `FirstStatusTable.tsx`** — client component. Props: `rows` (shape above). Local `useState<{key, dir}>` sort state; clickable `<th>` for Name, Consent & Release, Screening, Training (sort by status text; ties by name). Render screening as `<StatusBadge status={row.screeningStatus} />` plus, when `screeningText` is non-empty and status isn't green, the text in a `text-sm text-[var(--muted)]` line under the badge — this is the "what to chase" message. Consent: `<StatusBadge status={row.consent == null ? null : row.consent ? "green" : "blue"} label={row.consent == null ? "Not linked" : row.consent ? "Signed" : "Not signed"} />`. Name cell links to `/people/{personId}`. Follow the `table` + `tablewrap` classes used by the drive-sync page.

- [ ] **Step 5: `FirstLinkPicker.tsx`** — client component. Props: `{ firstPeopleId: number; people: { id: string; name: string }[] }`. A `<select>` (default "Link to person…") + confirm button; on submit `fetch("/api/admin/first/link", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ personId, firstPeopleId }) })`; on ok `router.refresh()`; on 409 show "That FIRST record is already linked to someone else."; other errors show the message inline (same outcome-state pattern as DriveSyncPanel).

- [ ] **Step 6: Verify in the browser** at this worktree's app URL (port in `.env`, `APP_PORT`, default for this worktree 3002): dev-login as Admin → `/admin/first-status` renders; the session card shows "No FIRST session saved"; pasting a real cookie and Saving shows "Session saved" and flips the card to "saved <when>"; Sync Now then returns a report (or, with no session, the "paste the cookie above" message) rendered sanely; sort toggles. Dev-login as Mentor → route redirects to `/`.

- [ ] **Step 7: Run `./dev npm run typecheck`, `./dev npm run lint`, `./dev npm run test`.** Expected: clean.

- [ ] **Step 8: Commit + push**

```bash
git add src/app/admin/first-status src/components/FirstStatusTable.tsx src/components/FirstSyncPanel.tsx src/components/FirstLinkPicker.tsx src/components/FirstSessionCard.tsx src/app/admin/page.tsx
git commit -m "feat(first-sync): admin FIRST status dashboard — session card, sync-now, manual link"
git push
```

---

### Task 6: Person-page FIRST status card

**Files:**
- Modify: `src/app/people/[id]/page.tsx`

**Interfaces:**
- Consumes: `Person.firstConsentRelease/firstScreeningStatus/firstScreeningText/firstTrainingStatus/firstSyncedAt` (Task 2), `StatusBadge` from `@/components/FirstStatusTable` (Task 5).

Visibility rule (spec): the card renders only when the subject is a mentor/admin AND (viewer is admin OR viewer is the subject). `canViewProfile` already gates the page; this gate is narrower and separate.

- [ ] **Step 1: Add the card** after the Teams section:

```tsx
{person.role !== "student" &&
  (hasRole(viewer.role, "admin") || viewer.person?.id === person.id) && (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">FIRST status</h2>
      {person.firstPeopleId == null ? (
        <p className="text-sm text-[var(--muted)]">
          Not linked to a FIRST roster record yet.
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
          <div>
            <dt className="label mb-0">Consent &amp; Release</dt>
            <dd><StatusBadge status={person.firstConsentRelease ? "green" : "blue"} label={person.firstConsentRelease ? "Signed" : "Not signed"} /></dd>
          </div>
          <div>
            <dt className="label mb-0">YPP screening</dt>
            <dd className="flex flex-col gap-1">
              <StatusBadge status={person.firstScreeningStatus} />
              {person.firstScreeningText && person.firstScreeningStatus !== "green" && (
                <span className="text-sm text-[var(--muted)]">{person.firstScreeningText}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="label mb-0">YPP training</dt>
            <dd><StatusBadge status={person.firstTrainingStatus} /></dd>
          </div>
          {person.firstSyncedAt && (
            <div className="sm:col-span-3">
              <dt className="label mb-0">Last synced</dt>
              <dd className="text-sm text-[var(--muted)]">{new Date(person.firstSyncedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  )}
```

- [ ] **Step 2: Verify in the browser**: as Admin view a mentor's page (card shows), a student's page (no card); as Mentor view own page (card shows) and another mentor's page (NO card).

- [ ] **Step 3: Run `./dev npm run typecheck`, `./dev npm run lint`, `./dev npm run test`.** Expected: clean.

- [ ] **Step 4: Commit + push**

```bash
git add src/app/people
git commit -m "feat(first-sync): FIRST status card on person page (admin or self)"
git push
```

---

### Task 7: E2E + full verification

**Files:**
- Create: `e2e/first-status.spec.ts`
- Possibly modify: `supabase/seed.sql` or the e2e seeding helpers — FOLLOW the existing e2e self-seeding pattern (read `e2e/badges.spec.ts` and `e2e/helpers/` first; e2e tests here self-seed rather than assume rows).

No FIRST network calls in CI: e2e seeds `person` status columns and `app_setting.first_last_sync_report` directly via the DB, then tests the UI. The sync engine's logic is already unit-tested; the cookie-replay path is covered by the Task 1 manual check only. Do NOT exercise the session-save route against real FIRST in e2e (it makes a live fetch) — seed `app_setting.first_session` directly if a test needs a "session present" state.

- [ ] **Step 1: Write `e2e/first-status.spec.ts`** following the repo's existing spec style (dev-login helpers, self-seeding). Cases:
  1. Seed: one active mentor with `first_people_id=101`, consent true, screening `green`, training `blue`; a `first_last_sync_report` app_setting with one `unmatchedFirst` entry `{peopleId: 999, name: "Zed Zulu", email: "zed@example.org"}` (use pinned UUIDs per the repo's stale-seed gotcha).
  2. Admin → `/admin/first-status`: table shows the mentor row with "Signed" and an "Action needed" training badge; unmatched card shows Zed Zulu; clicking a Name header re-sorts (assert row order flips with a second seeded mentor).
  3. Manual link: in the unmatched card pick a person, confirm, expect the row to disappear after refresh and the person's row to show statuses after a subsequent (seeded) state.
  4. Authz: mentor dev-login → `/admin/first-status` redirects to `/`; mentor viewing another mentor's `/people/[id]` does NOT see "FIRST status"; mentor viewing own page DOES.
- [ ] **Step 2: Run it**: `./dev npm run e2e -- first-status.spec.ts` (warm the dev server first — first route compile is slow; see repo gotcha). Expected: PASS.
- [ ] **Step 3: Full gates**: `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run e2e`. Expected: ALL PASS. Fix anything that fails before proceeding.
- [ ] **Step 4: `graphify update .`** (AST-only) to refresh the knowledge graph.
- [ ] **Step 5: Commit + push**

```bash
git add e2e/first-status.spec.ts
git commit -m "test(first-sync): e2e for FIRST status dashboard, link flow, authz"
git push
```

- [ ] **Step 6: Open the PR** (per repo rules: straight to push + `gh pr create`, report the URL; master auto-deploys on merge, so the PR body must include the rollout checklist below).

**Rollout checklist (manual, post-merge — include in PR body):**
1. `supabase db push` the two migrations to prod. (No FIRST env vars — auth is a pasted cookie.)
2. On prod DB: set `first_sync_url` to `https://hub.redalert1741.org/api/admin/first/sync` and `first_sync_secret` to a generated secret (`update app_setting set value = ... where key = ...` via Studio/SQL — settings values are one-off data, not schema).
3. Log into prod as admin → `/admin/first-status` → paste a fresh FIRST session cookie into the session card → Save (expect "Session saved").
4. Sync Now → verify the report and spot-check statuses against the FIRST dashboard.
5. Re-paste the cookie whenever the dashboard/sync reports the session expired (frequency depends on FIRST's session lifetime, currently unknown).
