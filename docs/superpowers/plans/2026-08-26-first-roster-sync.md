# FIRST Roster Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync mentors' Consent & Release, YPP screening, and YPP training statuses from my.firstinspires.org into the hub (nightly + Sync Now), shown on an admin dashboard and each person's page.

**Architecture:** A pure-ish sync engine (`src/lib/first-sync.ts`) fetches the FIRST roster page + status JSON with a cached cookie session (`src/lib/first-auth.ts` re-logs in via HTTP replay of the Azure B2C flow when cookies expire), matches FIRST people to `person` rows (first_people_id → email → nameKey), updates status columns on `person`, and persists a report. One API route runs it (admin session or `x-sync-secret` for pg_cron), one PATCH route backs manual linking, and two UI surfaces render the data.

**Tech Stack:** Next.js App Router, Supabase (service-role via `getDb()`), vitest, Playwright e2e, pg_cron + pg_net.

**Spec:** `docs/superpowers/specs/2026-08-26-first-roster-sync-design.md` (read it first — it contains the captured endpoint shapes and gotchas).

## Global Constraints

- Work in the `first-roster-sync` worktree (`.worktrees/first-roster-sync`). All commands run in the container: `./dev npm run test`, `./dev npm run typecheck`, etc. Never run node/npm on the host.
- Commit after every task and push immediately (`git push`). Commits are GPG-signed; if signing fails with "keyboxd not running", commit from PowerShell after `& "C:\Program Files (x86)\GnuPG\bin\gpg-connect-agent.exe" /bye`.
- Credentials: `FIRST_USERNAME` / `FIRST_PASSWORD` env vars only. NEVER write them to the DB, logs, fixtures, or test files.
- `GetPersonStatus` requires REPEATED `&ids=N&ids=M` params — comma-separated silently returns `[]`.
- FIRST people can hold multiple roles: always dedupe by `peopleId` (32 role entries → 29 unique adults on team 1741). Merge `ConsentReleaseStatus` as any-true.
- Adults = `role_category` ∈ {`Primary Team Contacts`, `Additional Team Contacts`}. Everything else (youth) is out of scope for v1.
- Never auto-create `person` rows from FIRST data.
- Migrations: new files only, never edit applied ones. New tables aren't needed; columns on `person` need no new grants (`person` already has service_role grants).
- Do not run graphify during implementation tasks; run `graphify update .` once at the end.

---

### Task 1: Login spike → `first-auth.ts` (GATE)

This task is a feasibility gate. If HTTP-replay login proves infeasible after honest effort (bot-wall, CAPTCHA appears, encrypted flow), STOP — report findings; do not proceed to Task 2. The fallback decision (Playwright) is the user's call.

**Files:**
- Create: `src/lib/first-auth.ts`
- Create: `scripts/check-first-login.mjs` (manual live check, not run in CI)
- Modify: `.env.example` (document `FIRST_USERNAME`, `FIRST_PASSWORD`)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/first-auth.ts
  export type CookieJar = Record<string, Record<string, string>>; // host -> cookie name -> value
  export function cookieHeader(jar: CookieJar, host: string): string;
  export function storeSetCookies(jar: CookieJar, host: string, setCookies: string[]): void;
  /** Full B2C login. Throws with a descriptive message on any step failure. */
  export async function loginToFirst(
    username: string,
    password: string,
    fetchFn?: typeof fetch,
  ): Promise<CookieJar>;
  /**
   * GET a my.firstinspires.org URL with the jar. Returns { kind: "ok", body } on 200,
   * { kind: "auth" } when redirected to firstcommunity.firstinspires.org (session expired).
   */
  export async function fetchWithSession(
    url: string,
    jar: CookieJar,
    fetchFn?: typeof fetch,
  ): Promise<{ kind: "ok"; body: string } | { kind: "auth" }>;
  ```

The B2C replay algorithm (adapt exact field names from what you observe live — this is the spike):

1. `GET https://my.firstinspires.org/Dashboard/` with `redirect: "manual"`, following each 3xx yourself and collecting `Set-Cookie` (use `response.headers.getSetCookie()`) per host into the jar, until you land on the `firstcommunity.firstinspires.org/.../oauth2/v2.0/authorize` page (200 HTML). Keep the final authorize URL.
2. Parse the authorize page HTML for the `SETTINGS` JS object: `var SETTINGS = {...};` — extract `csrf`, `transId` (looks like `StateProperties=...`), and the policy (`hosts.policy` or the `p=` param, e.g. `B2C_1A_signup_signin`).
3. `POST https://firstcommunity.firstinspires.org/<tenantId>/<policy>/SelfAsserted?tx=<transId>&p=<policy>` with headers `X-CSRF-TOKEN: <csrf>`, `Content-Type: application/x-www-form-urlencoded`, B2C cookies; body `request_type=RESPONSE&signInName=<username>&password=<password>` (observe the real field names — may be `email` instead of `signInName`). Expect JSON `{"status":"200"}`.
4. `GET .../<tenantId>/<policy>/api/CombinedSigninAndSignup/confirmed?rememberMe=false&csrf_token=<csrf>&tx=<transId>&p=<policy>` following redirects manually. The terminal response is an auto-submitting HTML `<form method="POST" action="https://my.firstinspires.org/...">` with hidden inputs (`state`, `code`, `id_token` — whatever is present).
5. Parse those hidden inputs and `POST` them (form-encoded) to the form's `action` URL with the my.firstinspires.org cookies; collect the resulting session `Set-Cookie`s into the jar. Follow any final same-host redirects.
6. Done — the jar now authenticates roster requests.

`fetchWithSession`: `GET url` with `Cookie: cookieHeader(jar, "my.firstinspires.org")`, `redirect: "manual"`. 200 → ok. 3xx whose `Location` contains `firstcommunity.firstinspires.org` (or any 302 to `/Login`) → `{ kind: "auth" }`. Anything else → throw.

- [ ] **Step 1: Write `src/lib/first-auth.ts`** with the jar helpers and the login flow above. Every network step that fails must throw an `Error` naming the step (e.g. `first-auth: SelfAsserted returned 403`) WITHOUT including credentials or cookie values.

- [ ] **Step 2: Write `scripts/check-first-login.mjs`** — a manual live check (this is the one runnable check for this task; the login flow is deliberately not unit-tested):

```js
// Manual integration check: ./dev node scripts/check-first-login.mjs
// Requires FIRST_USERNAME/FIRST_PASSWORD in the environment. Not run in CI.
import { loginToFirst, fetchWithSession } from "../src/lib/first-auth.ts";

const user = process.env.FIRST_USERNAME;
const pass = process.env.FIRST_PASSWORD;
if (!user || !pass) throw new Error("Set FIRST_USERNAME and FIRST_PASSWORD");

const jar = await loginToFirst(user, pass);
const res = await fetchWithSession(
  "https://my.firstinspires.org/Teams/Page/TeamContacts/TeamRoster?TeamProfileID=1790765",
  jar,
);
if (res.kind !== "ok") throw new Error("session did not authenticate");
if (!res.body.includes("teamContactsModel")) throw new Error("roster model missing from page");
console.log("OK: logged in, roster page fetched,", res.body.length, "bytes");
```

If plain `node` can't import the `.ts` file, run it via `./dev npx tsx scripts/check-first-login.mjs` (tsx is fine as a devDependency if not present).

- [ ] **Step 3: Run the live check** with real credentials: `./dev npx tsx scripts/check-first-login.mjs`. Expected: `OK: logged in, ...`. Iterate on field names/steps by inspecting each intermediate response until it passes. If blocked by bot-detection/CAPTCHA: STOP THE PLAN and report.

- [ ] **Step 4: Add to `.env.example`**:

```
# FIRST dashboard sync (my.firstinspires.org admin account)
FIRST_USERNAME=
FIRST_PASSWORD=
```

- [ ] **Step 5: Run `./dev npm run typecheck` and `./dev npm run lint`.** Expected: clean.

- [ ] **Step 6: Commit + push**

```bash
git add src/lib/first-auth.ts scripts/check-first-login.mjs .env.example package.json package-lock.json
git commit -m "feat(first-sync): B2C HTTP-replay login + session fetch"
git push
```

---

### Task 2: Migration + types

**Files:**
- Create: `supabase/migrations/<timestamp>_first_roster_sync.sql` (generate timestamp: `date +%Y%m%d%H%M%S` UTC)
- Modify: `src/lib/types.ts` (PersonRow, Person, personFromRow)

**Interfaces:**
- Produces: `person` columns `first_people_id`, `first_consent_release`, `first_screening_status`, `first_screening_text`, `first_training_status`, `first_synced_at`; app_setting keys `first_team_profile_id`, `first_sync_secret`, `first_sync_url`, `first_session_cookies`, `first_last_sync_report`. TS fields `firstPeopleId`, `firstConsentRelease`, `firstScreeningStatus`, `firstScreeningText`, `firstTrainingStatus`, `firstSyncedAt` on `Person`.

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
  ('first_session_cookies', 'null'),
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
- Consumes: `loginToFirst`, `fetchWithSession`, `CookieJar` from `./first-auth` (Task 1); `nameKey` from `./name-match`; `getSetting` from `./settings`.
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
1. Read settings: `first_team_profile_id` (string or number — normalize to string), `first_session_cookies` (as `CookieJar | null`).
2. `fetchWithSession(rosterUrl, jar)`; on `{kind:"auth"}` or null jar: check `process.env.FIRST_USERNAME/FIRST_PASSWORD` (throw `Error("first_not_configured")` if missing), `loginToFirst(...)`, upsert the new jar into `app_setting.first_session_cookies`, retry ONCE. Second `auth` → throw `Error("first_login_failed")`.
3. `parseTeamContactsModel`: locate the `teamContactsModel` assignment in the HTML — find the marker `teamContactsModel`, then the first `{` after the `=`, then brace-count (respecting strings) to the matching `}` and `JSON.parse` the slice. Throws with a clear message when the marker is absent.
4. `adultsFromModel`: read `PeopleRoles` array; keep entries whose `role_category` is `"Primary Team Contacts"` or `"Additional Team Contacts"`; group by `peopleId`; merge consent any-true; take first-seen non-empty name/email; lowercase email.
5. Fetch `statusUrl(...)` via `fetchWithSession`; parse JSON array; fold `screening.status/.text` and `training.status` into the `FirstPerson`s by `peopleId` (missing entry → statuses stay null).
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

### Task 4: Sync + link API routes, cron migration

**Files:**
- Create: `src/app/api/admin/first/sync/route.ts`
- Create: `src/app/api/admin/first/link/route.ts`
- Create: `supabase/migrations/<timestamp>_first_sync_cron.sql`

**Interfaces:**
- Consumes: `syncFirstRoster` (Task 3), `getSetting`, `getDb`, `getViewer`, `hasRole`, `secureEqual` (`src/lib/secure-compare`).
- Produces: `POST /api/admin/first/sync` → `FirstSyncReport` JSON | `{error}`; `PATCH /api/admin/first/link` body `{ personId: string, firstPeopleId: number | null }` → `{ok: true}`.

- [ ] **Step 1: Write the sync route** — clone the dual-auth shape of `src/app/api/admin/calendar/sync/route.ts` exactly, with these differences: setting key `first_sync_secret`, session gate `hasRole(viewer.role, "admin")` (admin, not mentor — spec: non-admin mentors can't see others' status), missing-env check:

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

  if (!process.env.FIRST_USERNAME || !process.env.FIRST_PASSWORD) {
    return Response.json(
      {
        error: "not_configured",
        have: {
          username: Boolean(process.env.FIRST_USERNAME),
          password: Boolean(process.env.FIRST_PASSWORD),
        },
      },
      { status: 400 },
    );
  }

  try {
    const report = await syncFirstRoster({ db });
    return Response.json(report);
  } catch (e) {
    console.error("first sync failed:", e);
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Write the link route** (`src/app/api/admin/first/link/route.ts`): admin-only (same viewer gate, no secret path). Validate body: `personId` non-empty string, `firstPeopleId` integer or null → else 400 `{error:"bad_request"}`. Update: `db.from("person").update({ first_people_id: firstPeopleId }).eq("id", personId)`; check `error` (unique violation on an already-linked id → 409 `{error:"already_linked"}`, code `23505`); return `{ok:true}`.

- [ ] **Step 3: Write the cron migration** — clone `supabase/migrations/20260811084653_calendar_cron.sql`, job name `first-nightly-sync`, schedule `0 8 * * *`, URL setting `first_sync_url`, secret setting `first_sync_secret`. (The URL/secret seeds already exist from Task 2 — this migration only adds the `cron.schedule` call.)

- [ ] **Step 4: Apply + verify**: `./dev npm run db:reset`, then with the stack running, exercise the route with the secret header:

```bash
./dev bash -lc 'curl -s -X POST -H "x-sync-secret: $(echo dummy)" localhost:3000/api/admin/first/sync'
```

Expected: `{"error":"forbidden"}` (secret is empty in DB, header wrong → falls to session gate → guest → 403). Set a secret and FIRST_* envs locally if you want a full live run; otherwise the e2e task covers the authorized path with mocks.

- [ ] **Step 5: Run `./dev npm run typecheck`, `./dev npm run lint`, `./dev npm run test`.** Expected: clean.

- [ ] **Step 6: Commit + push**

```bash
git add src/app/api/admin/first supabase/migrations/*_first_sync_cron.sql
git commit -m "feat(first-sync): sync + manual-link routes, nightly cron"
git push
```

- [ ] **Step 7: Verify login works in the Vercel runtime (spec gate, second half).** The push creates a Vercel preview deployment. Ask the user to add `FIRST_USERNAME`/`FIRST_PASSWORD` to the Vercel *preview* environment (they may already have). Note the preview DB is prod's Supabase — `first_sync_secret` may be empty there, so test with a browser admin session on the preview URL, or coordinate with the user to run Sync Now from the preview's `/admin/first-status` once Task 5 lands. Minimum bar before finishing the plan: one successful `syncFirstRoster` run (real report JSON, no `sync_failed`) from a Vercel function. If B2C login fails only on Vercel (IP reputation, TLS fingerprint), STOP and report — that reopens the Playwright fallback decision.

---

### Task 5: Admin dashboard `/admin/first-status`

**Files:**
- Create: `src/app/admin/first-status/page.tsx` (server component)
- Create: `src/components/FirstStatusTable.tsx` (client: sortable table)
- Create: `src/components/FirstSyncPanel.tsx` (client: Sync Now)
- Create: `src/components/FirstLinkPicker.tsx` (client: link unmatched FIRST entry to a person)
- Modify: `src/app/admin/page.tsx` (add a nav card/link to `/admin/first-status`, matching how other admin tools are listed there)

**Interfaces:**
- Consumes: `FirstSyncReport` from `@/lib/first-sync`; `getSetting`; `listPeople(undefined, db)`; `displayName` from `@/lib/people`; `POST /api/admin/first/sync`; `PATCH /api/admin/first/link`.
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

- [ ] **Step 1: Page server component.** Gate: `getViewer()` → `if (!hasRole(viewer.role, "admin")) redirect("/")` (same as drive-sync page). Load `listPeople(undefined, db)` filtered to `role !== "student" && is_active`, plus `getSetting<FirstSyncReport | null>("first_last_sync_report", null, db)`. Render:
  1. Page head: title "FIRST roster status", sub showing `first_synced_at`-style "Last synced …" from the report's `ranAt` (or "never").
  2. `<FirstSyncPanel />` in a card.
  3. `<FirstStatusTable rows={...} />` in a card — one row per active mentor/admin from `person` (statuses straight off the row columns; people with no `first_people_id` still get a row with a "Not linked" pill in the consent column area).
  4. "Unmatched FIRST roster entries" card: from `report.unmatchedFirst`, each row name + email + `<FirstLinkPicker firstPeopleId={...} people={peoplePicker} />` where `peoplePicker` is the same `{id, name}` list pattern as the drive-sync page. Empty state: "Everything on the FIRST roster is linked."

- [ ] **Step 2: `FirstSyncPanel.tsx`** — clone `src/components/DriveSyncPanel.tsx` verbatim, changing: endpoint `/api/admin/first/sync`, ok-state message `Synced — {matched} matched, {updated} updated, {unmatchedFirst.length} unmatched.` (read those fields off the response body), error state unchanged.

- [ ] **Step 3: `FirstStatusTable.tsx`** — client component. Props: `rows` (shape above). Local `useState<{key, dir}>` sort state; clickable `<th>` for Name, Consent & Release, Screening, Training (sort by status text; ties by name). Render screening as `<StatusBadge status={row.screeningStatus} />` plus, when `screeningText` is non-empty and status isn't green, the text in a `text-sm text-[var(--muted)]` line under the badge — this is the "what to chase" message. Consent: `<StatusBadge status={row.consent == null ? null : row.consent ? "green" : "blue"} label={row.consent == null ? "Not linked" : row.consent ? "Signed" : "Not signed"} />`. Name cell links to `/people/{personId}`. Follow the `table` + `tablewrap` classes used by the drive-sync page.

- [ ] **Step 4: `FirstLinkPicker.tsx`** — client component. Props: `{ firstPeopleId: number; people: { id: string; name: string }[] }`. A `<select>` (default "Link to person…") + confirm button; on submit `fetch("/api/admin/first/link", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ personId, firstPeopleId }) })`; on ok `router.refresh()`; on 409 show "That FIRST record is already linked to someone else."; other errors show the message inline (same outcome-state pattern as DriveSyncPanel).

- [ ] **Step 5: Verify in the browser** at this worktree's app URL (port in `.env`, `APP_PORT`, default for this worktree 3002): dev-login as Admin → `/admin/first-status` renders, sort toggles, Sync Now returns either a report (if envs set) or the not_configured/sync_failed error rendered sanely. Dev-login as Mentor → route redirects to `/`.

- [ ] **Step 6: Run `./dev npm run typecheck`, `./dev npm run lint`, `./dev npm run test`.** Expected: clean.

- [ ] **Step 7: Commit + push**

```bash
git add src/app/admin/first-status src/components/FirstStatusTable.tsx src/components/FirstSyncPanel.tsx src/components/FirstLinkPicker.tsx src/app/admin/page.tsx
git commit -m "feat(first-sync): admin FIRST status dashboard with sync-now and manual link"
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

No FIRST network calls in CI: e2e seeds `person` status columns and `app_setting.first_last_sync_report` directly via the DB, then tests the UI. The sync engine's logic is already unit-tested; the login path is covered by the Task 1 manual check only.

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
1. Vercel: add `FIRST_USERNAME` / `FIRST_PASSWORD` env vars (production).
2. `supabase db push` the two migrations to prod.
3. On prod DB: set `first_sync_url` to `https://hub.redalert1741.org/api/admin/first/sync` and `first_sync_secret` to a generated secret (`update app_setting set value = ... where key = ...` via Studio/SQL — settings values are one-off data, not schema).
4. Log into prod as admin → `/admin/first-status` → Sync Now → verify the report and spot-check statuses against the FIRST dashboard.
