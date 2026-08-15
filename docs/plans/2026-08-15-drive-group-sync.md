# Google Drive Group Sync Implementation Plan (#30, as amended)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams can be linked 1:1 to Google Workspace Groups (FRC Mentor team → FRC Mentors group, FRC Student team → FRC Students group); membership changes sync to the groups in real time, a nightly cron + admin "Sync now" reconcile heals drift by **adding** missing members, and removals are **report-only** (a "would be removed" list for verification) — except an explicit real-time team-leave, which does remove that one person from that one group.

**Architecture:** Mirrors the existing Google Calendar integration: a service-account JWT (now with domain-wide delegation + admin impersonation via a `sub` claim) exchanged for an access token, a lib module wrapping the Admin SDK Directory API, a sync engine with a pure diff core, a route gated by `x-sync-secret` OR mentor+ session, and a `pg_cron` + `pg_net` nightly schedule reading URL/secret from `app_setting` at run time. The team→group mapping is a nullable `google_group_email` column on `team` (null = not synced), editable from the admin team page.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres (PostgREST service-role via `getDb()`), `pg_cron`/`pg_net`, Google Admin SDK Directory API, vitest.

## Global Constraints

- Docker dev: tests `docker exec team-hub-app-1 npx vitest run`; typecheck `docker exec team-hub-app-1 npx tsc --noEmit` (ignore pre-existing errors under `.next/dev/types/**`).
- Migrations as code: new migration file, applied via psql (`postgresql://postgres:postgres@host.docker.internal:54322/postgres?sslmode=disable`) and recorded in `supabase_migrations.schema_migrations(version, name)`. The in-container Supabase CLI cannot reach the DB. Never edit an applied migration.
- **Removal policy:** the reconcile (nightly and Sync now) NEVER removes anyone from a group. It adds missing members and reports `wouldRemove`. The ONLY removal path is the real-time hook when a person is explicitly removed from a linked team.
- People without an email are silently skipped everywhere (can't be in a group).
- Expected group membership = team members whose person `is_active = true` AND `email` is non-null. Compare emails case-insensitively (lowercase both sides).
- Real-time sync is best-effort: a Google API failure must never fail the team-membership operation itself — log and let reconcile heal.
- Never log or return credential values; presence booleans only (mirror the calendar route's `have:` shape).
- Reuse `GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY`; new env `GOOGLE_ADMIN_SUBJECT` (Workspace admin to impersonate). Missing any → Directory integration is unconfigured → real-time hooks no-op, sync route returns `not_configured`.
- Directory scope: exactly `https://www.googleapis.com/auth/admin.directory.group.member`.

---

### Task 1: Shared Google service-account auth (refactor out of gcal)

**Files:**
- Create: `src/lib/google-auth.ts`
- Modify: `src/lib/gcal.ts` (delete its local `base64url`, `buildServiceAccountJwt`, `fetchAccessToken`; import instead)
- Test: `src/lib/google-auth.test.ts`; Modify: `src/lib/gcal.test.ts` (move/keep JWT tests pointing at the new module)

**Interfaces:**
- Produces:
  ```ts
  export type GoogleSaCreds = { clientEmail: string; privateKey: string };
  export function buildServiceAccountJwt(
    creds: GoogleSaCreds,
    opts: { scope: string; subject?: string },
    now: () => number = Date.now,
  ): string;
  export async function fetchGoogleAccessToken(
    fetchFn: typeof globalThis.fetch,
    creds: GoogleSaCreds,
    opts: { scope: string; subject?: string },
    now?: () => number,
  ): Promise<string>;
  ```
- The JWT claims are `{ iss, scope, aud: "https://oauth2.googleapis.com/token", iat, exp: iat+3600 }` plus `sub: subject` **only when `subject` is provided** (domain-wide delegation impersonation). RS256, base64url, same as today's gcal implementation.

Steps:
- [ ] Write failing tests in `src/lib/google-auth.test.ts`: (a) JWT payload decodes to the right `iss`/`scope`/`aud`/`iat`/`exp`; (b) `sub` present iff `subject` passed; (c) `fetchGoogleAccessToken` posts `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` to `https://oauth2.googleapis.com/token` and returns `access_token`; throws on non-OK and on missing token. Use a locally generated RSA key (`node:crypto generateKeyPairSync("rsa", { modulusLength: 2048 })`) like gcal.test.ts does today.
- [ ] Run: `docker exec team-hub-app-1 npx vitest run src/lib/google-auth.test.ts` — FAIL (module missing).
- [ ] Implement `google-auth.ts` by lifting the gcal code verbatim, parameterizing `scope`/`subject`.
- [ ] Rewire `gcal.ts`: keep its exported `buildServiceAccountJwt(creds, now)` signature working by delegating (`return buildJwt(creds, { scope: SCOPE }, now)`) or update its callers/tests to the new module — implementer's choice, but `gcal.test.ts` must still pass unchanged in behavior.
- [ ] Run: `docker exec team-hub-app-1 npx vitest run src/lib/google-auth.test.ts src/lib/gcal.test.ts` — PASS.
- [ ] Commit: `refactor(google): shared service-account JWT/token helper with impersonation support`

### Task 2: Migration — team.google_group_email + nightly cron + settings

**Files:**
- Create: `supabase/migrations/20260815200000_drive_group_sync.sql`

Steps:
- [ ] Write the migration:
  ```sql
  -- Link a team to a Google Workspace Group: membership in the team mirrors
  -- into the group (null = this team does not sync). Group emails are set by
  -- an admin in the team edit UI, not seeded here.
  alter table team add column if not exists google_group_email text;

  -- Nightly Drive-group reconcile via pg_net → the app's sync endpoint, same
  -- pattern as gcal-hourly-sync: URL + secret read from app_setting AT RUN
  -- TIME. Reconcile ADDS missing members and only REPORTS would-be removals.
  insert into app_setting (key, value) values
    ('drive_sync_url', '"http://host.docker.internal:3000/api/admin/drive-group/sync"')
  on conflict (key) do nothing;

  create extension if not exists pg_net;

  select cron.schedule(
    'drive-group-nightly-sync',
    '0 7 * * *',  -- 07:00 UTC ≈ 2-3am team-local (America/Indiana)
    $cron$
    select net.http_post(
      url := (select value #>> '{}' from public.app_setting where key = 'drive_sync_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'drive_sync_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
  ```
  (`drive_sync_secret` is deliberately NOT seeded — the route treats an empty secret as never-authorizing, exactly like `gcal_sync_secret`.)
- [ ] Validate: `docker exec team-hub-app-1 psql "postgresql://postgres:postgres@host.docker.internal:54322/postgres?sslmode=disable" -c 'begin;' -f /workspaces/hub/supabase/migrations/20260815200000_drive_group_sync.sql -c 'rollback;'` — no errors. (cron.schedule inside a rolled-back tx is fine; it just must parse/execute.)
- [ ] Apply for real (same command with `commit;`), then record:
  `insert into supabase_migrations.schema_migrations (version, name) values ('20260815200000', 'drive_group_sync');`
- [ ] Commit: `feat(drive-sync): team.google_group_email column + nightly reconcile cron`

### Task 3: Directory API client

**Files:**
- Create: `src/lib/google-directory.ts`
- Test: `src/lib/google-directory.test.ts`

**Interfaces:**
- Consumes: `fetchGoogleAccessToken` from Task 1.
- Produces:
  ```ts
  export type DirectoryCredentials = { clientEmail: string; privateKey: string; adminSubject: string };
  export function directoryCredentialsFromEnv(): DirectoryCredentials | null; // GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY (restore \n), GOOGLE_ADMIN_SUBJECT
  export type DirectoryDeps = { fetch: typeof globalThis.fetch; credentials: DirectoryCredentials; now?: () => number };
  export const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";
  export async function listGroupMembers(deps: DirectoryDeps, groupEmail: string): Promise<string[]>; // lowercased emails, paginated
  export async function insertGroupMember(deps: DirectoryDeps, groupEmail: string, email: string): Promise<{ ok: boolean; status: number }>; // 409 conflict → ok:true (already a member)
  export async function deleteGroupMember(deps: DirectoryDeps, groupEmail: string, email: string): Promise<{ ok: boolean; status: number }>; // 404 → ok:true (already gone)
  ```
- Endpoints: base `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`; list paginates via `pageToken`/`nextPageToken` with `maxResults=200`; insert POSTs `{ email, role: "MEMBER" }`; delete targets `/members/${encodeURIComponent(email)}`. Token fetched once per exported call via `fetchGoogleAccessToken(fetch, creds, { scope: DIRECTORY_SCOPE, subject: creds.adminSubject })`.

Steps:
- [ ] Failing tests with a fake `fetch` (queue of canned responses, capturing requests): list follows pagination and lowercases; insert returns ok on 200 and on 409, not-ok on 500; delete ok on 200 and 404; every Directory request carries `Authorization: Bearer <token>`; the token-exchange JWT includes `sub` = adminSubject (decode the captured assertion).
- [ ] Run: `docker exec team-hub-app-1 npx vitest run src/lib/google-directory.test.ts` — FAIL.
- [ ] Implement; run — PASS.
- [ ] Commit: `feat(drive-sync): Google Directory API client (list/insert/delete group members)`

### Task 4: Sync engine + real-time hooks

**Files:**
- Create: `src/lib/drive-group-sync.ts`
- Modify: `src/lib/teams.ts` (`upsertMember`, `removeMember`, `joinTeam` — call the hook after a successful write)
- Test: `src/lib/drive-group-sync.test.ts`

**Interfaces:**
- Consumes: Task 3's client; `getSetting`-style `app_setting` upsert via the db client.
- Produces:
  ```ts
  export function computeGroupDiff(expected: string[], actual: string[]): { missing: string[]; extra: string[] }; // PURE, case-insensitive, deduped
  export type GroupReconcileReport = {
    teamName: string; groupEmail: string;
    expectedCount: number; actualCount: number;
    added: string[];        // inserted this run (or failed-to-insert listed in errors)
    wouldRemove: string[];  // in group, not expected — REPORT ONLY, never removed
    errors: string[];
  };
  export type ReconcileResult = { ranAt: string; groups: GroupReconcileReport[] };
  export async function reconcileDriveGroups(deps: { db: SupabaseClient; fetch: typeof globalThis.fetch; credentials: DirectoryCredentials; now?: () => number }): Promise<ReconcileResult>;
  export async function syncMembershipChange(action: "add" | "remove", teamId: string, personId: string, db: SupabaseClient): Promise<void>; // best-effort, never throws
  ```
- `reconcileDriveGroups`: load linked teams (`team` where `google_group_email` not null); per team compute expected = `team_membership` joined to `person` where `is_active` and `email` non-null → lowercased emails; actual = `listGroupMembers`; `insertGroupMember` each missing; collect extra into `wouldRemove`; a per-group API failure goes into that group's `errors` and the run continues to the next group. Persist the whole result: `db.from("app_setting").upsert({ key: "drive_last_reconcile", value: result }, { onConflict: "key" })`. Return it.
- `syncMembershipChange`: no-op (silent return) when `directoryCredentialsFromEnv()` is null, when the team has no `google_group_email`, or when the person has no email or is inactive. Otherwise insert/delete the one member. Wrap everything in try/catch → `console.error("drive-group sync failed", { action, teamId, personId, error })`. **This function is the only automatic removal path, and it fires only on an explicit removal from a linked team.**
- Hooks in `teams.ts` (each after its success path, before returning ok): `upsertMember` → `await syncMembershipChange("add", teamId, personId, client)`; `removeMember` → `("remove", ...)`; `joinTeam` → `("add", ...)`. This covers the admin members API, application approval (`approveApplication` calls `upsertMember`), and self-service joins. Import normally — `drive-group-sync.ts` must not import `teams.ts` (no cycle).

Steps:
- [ ] Failing tests: `computeGroupDiff` (mixed case, dupes, both-empty); `reconcileDriveGroups` with fake db+fetch — adds exactly the missing member, records `wouldRemove` without any delete call, persists `drive_last_reconcile`, continues past a failing group; `syncMembershipChange` — no-ops on unlinked team / missing email / unconfigured env; calls insert on add and delete on remove when configured. For env, set/unset `process.env.GOOGLE_*` in the test with `beforeEach`/`afterEach` restore. Follow the fake-db harness style of `src/lib/sessions.test.ts` / `attendance.test.ts`.
- [ ] Run: `docker exec team-hub-app-1 npx vitest run src/lib/drive-group-sync.test.ts` — FAIL.
- [ ] Implement lib; wire the three `teams.ts` hooks.
- [ ] Run full suite: `docker exec team-hub-app-1 npx vitest run` — PASS (existing `teams`/`requests` tests must still pass; their fake dbs won't have creds configured, so hooks no-op).
- [ ] Commit: `feat(drive-sync): reconcile engine (adds + report-only removals) and real-time membership hooks`

### Task 5: Sync route (cron + Sync now)

**Files:**
- Create: `src/app/api/admin/drive-group/sync/route.ts`
- Test: covered by lib tests + e2e gating (below); route mirrors `src/app/api/admin/calendar/sync/route.ts` line-for-line in structure.

**Interfaces:**
- Consumes: `reconcileDriveGroups`, `directoryCredentialsFromEnv` (Task 3/4); `getSetting`, `secureEqual`, `getViewer`, `hasRole`.
- POST only. Gate 1: `x-sync-secret` header vs `drive_sync_secret` setting (empty secret never authorizes). Gate 2 (fallback): mentor+ session. Unconfigured creds → 400 `{ error: "not_configured", have: { clientEmail, privateKey, adminSubject } }` (booleans). Success → the `ReconcileResult` JSON. Failure → `console.error` + 502 `{ error: "sync_failed" }`.

Steps:
- [ ] Implement the route (copy the calendar route's structure; swap setting key, creds fn, engine call).
- [ ] Typecheck: `docker exec team-hub-app-1 npx tsc --noEmit` — no new errors outside `.next/dev/types/`.
- [ ] Manual smoke (dev, unconfigured): `curl -s -X POST http://localhost:3000/api/admin/drive-group/sync` → 403 (no secret, no session). That confirms gating without Google creds.
- [ ] Commit: `feat(drive-sync): sync endpoint gated by x-sync-secret or mentor session`

### Task 6: Team edit UI/API — Google Group email field

**Files:**
- Modify: `src/lib/types.ts` (`TeamRow` + `Team` + `teamFromRow`: `google_group_email` / `googleGroupEmail: string | null`)
- Modify: `src/lib/teams.ts` (`TeamInput` gains `googleGroupEmail: string | null`; `parseTeamInput` parses it via `optString(b.googleGroupEmail, 254)`; `createTeam`/`updateTeam` write the column)
- Modify: the admin team form component (find it from `src/app/admin/teams/[id]/page.tsx` — extend whatever form posts to `/api/admin/teams/[id]`; add a text input labeled "Google Group email" with help text "Members of this team are synced into this Workspace group. Leave blank to disable.")
- Test: `src/lib/teams.test.ts` (parse cases: absent → null is fine, blank → null, value trimmed/kept; row mapping)

Steps:
- [ ] Failing tests for `parseTeamInput` + `teamFromRow` with the new field.
- [ ] Run: `docker exec team-hub-app-1 npx vitest run src/lib/teams.test.ts` — FAIL.
- [ ] Implement types + lib + form field (follow the form's existing field markup; the API route already passes the parsed body through `parseTeamInput`, so no route change).
- [ ] Run: full `npx vitest run` + `npx tsc --noEmit` — PASS/clean.
- [ ] Commit: `feat(drive-sync): per-team Google Group email, editable on the admin team page`

### Task 7: Admin Drive-sync page (report + Sync now)

**Files:**
- Create: `src/app/admin/drive-sync/page.tsx` (server component, admin-gated like other admin pages: `getViewer()` + `hasRole(viewer.role, "admin")` else `redirect("/login")`)
- Create: `src/components/DriveSyncPanel.tsx` (client: "Sync now" button → POST `/api/admin/drive-group/sync` → show returned summary or error → `router.refresh()`)
- Modify: `src/app/admin/page.tsx` (add a card/link "Drive group sync", matching the existing admin index entries)
- Modify (only if the e2e auth-gating spec enumerates admin pages): `e2e/auth-gating.spec.ts` — add `/admin/drive-sync`.

Page content (server-rendered):
- Linked teams table: team name, group email, expected member count (active + has email).
- Last reconcile report from the `drive_last_reconcile` setting: ranAt timestamp, then per group — added emails, `wouldRemove` emails each resolved to a person name when the email matches a `person.email` (lowercased compare; unmatched emails shown raw), and errors. Empty state: "No reconcile has run yet."
- A visible note: "Reconcile adds missing members. Nobody is removed automatically — review the 'would be removed' list below." (This is the verification surface the user asked for, and it's most of #44's report too.)

Steps:
- [ ] Implement page + panel + admin-index link (+ gating spec entry if applicable).
- [ ] `docker exec team-hub-app-1 npx tsc --noEmit` clean; `npx vitest run` green.
- [ ] Screenshot check of `/admin/drive-sync` in dev (throwaway e2e screenshot spec pattern) — layout sane in both themes.
- [ ] Commit: `feat(drive-sync): admin page with linked teams, reconcile report, and Sync now`

### Task 8: Setup docs

**Files:**
- Create: `docs/setup/google-drive-groups.md` (mirror `docs/setup/google-calendar.md`'s structure)

Content (write it fully, not an outline): enable Admin SDK API in the existing Google Cloud project; add domain-wide delegation for the service account in the Workspace Admin console with exactly scope `https://www.googleapis.com/auth/admin.directory.group.member`; set env `GOOGLE_ADMIN_SUBJECT` (a Workspace admin with Groups privileges) alongside the existing `GOOGLE_SA_*`; set each synced team's "Google Group email" in the admin team page; set `drive_sync_secret` (generate: `openssl rand -hex 32`) and prod `drive_sync_url` app settings; note the removal policy (adds only; would-remove is report-only) and the nightly 07:00 UTC cron name `drive-group-nightly-sync`.

Steps:
- [ ] Write the doc.
- [ ] Commit: `docs(drive-sync): Workspace + env setup for Drive group sync`

---

## Self-Review

- **Spec coverage:** team→group 1:1 mapping (T2/T6); real-time add AND remove on explicit join/leave (T4); manual Sync now (T5/T7); nightly reconcile (T2 cron → T5 route); reconcile adds + report-only removals (T4, constraint); would-be-removed list displayed for verification (T7); no-email people skipped (constraint, T4); email changes healed nightly (reconcile recomputes expected — no extra code); config mirrors calendar pattern (T2/T5/T8). ✓
- **Placeholder scan:** none — every task carries concrete signatures, SQL, endpoints, and copy. ✓
- **Type consistency:** `DirectoryCredentials`/`DirectoryDeps` (T3) are what T4/T5 consume; `GroupReconcileReport.wouldRemove` naming is used consistently in T4 and T7; `googleGroupEmail` camelCase in `Team`, `google_group_email` in rows/SQL. ✓
- **Known deferrals (deliberate):** actual removal execution (future flip once the report is verified); FTC groups (set their team fields when ready — zero code); #44's standalone audit report (T7's wouldRemove display covers the core; #44 can grow from it).
