# FIRST Roster Sync — Design (v1: mentors)

Date: 2026-08-26
Status: approved

## Goal

Sync each mentor's FIRST standing — **Consent & Release**, **YPP screening**,
and **YPP training** — from the my.firstinspires.org team dashboard into the
hub, nightly and on demand, and surface it:

- on an admin dashboard listing every active mentor/admin with sortable status
  columns, so admins can see who still has tasks to complete;
- on each person's page (admins see anyone; a non-admin mentor sees only their
  own; students see nothing).

Students are v2. No history — current standing only.

## Source of truth (captured 2026-08-26 from a live session)

Two endpoints on my.firstinspires.org, both requiring an authenticated
session:

1. **Roster (HTML)** — `GET /Teams/Page/TeamContacts/TeamRoster?TeamProfileID=<id>`
   The page embeds `window.teamContactsModel`; `PeopleRoles` is an array of
   role entries with (fields we use): `peopleId` (int), `name_first`,
   `name_last`, `nickname_first`, `email`, `phone`, `role_category`,
   `role_key`, `RoleName`, `ConsentReleaseStatus` (boolean).

   Gotchas:
   - **People can hold multiple roles** (32 entries → 29 unique adults for
     1741). Dedupe by `peopleId`; merge `ConsentReleaseStatus` as any-true.
   - Adults are `role_category` ∈ {`Primary Team Contacts`,
     `Additional Team Contacts`}. Filter to those (youth categories exist and
     are v2).

2. **Status (JSON)** — `GET /Teams/Page/TeamContacts/GetPersonStatus?TeamProfileID=<id>&ids=<a>&ids=<b>…`
   - **`ids` must be a repeated query param.** Comma-separated silently
     returns `[]`.
   - Per person: `{ peopleId, screening: {status, text, icon}, supplemental:
     {status, text, stateprov}, training: {status, icon, text?} }`.
   - `status` is a color word: observed `green`, `blue`, `orange`, `grey`.
   - `screening.text` carries the actionable next step (e.g. "This person
     needs to log into their FIRST Dashboard and proceed to the screening
     vendor") — store it, the dashboard shows it.
   - `supplemental` is uniformly grey/empty for Indiana — **excluded from
     v1**. Known extra if it ever populates.

### Authentication — manual cookie refresh

**Superseded decision (2026-08-26):** the original plan was automated HTTP-replay
login. A spike (commit `f73f8bb`) proved it infeasible: FIRST federates login
through Microsoft, and the team-admin account is a **personal Microsoft Account
(MSA)** whose real sign-in happens at `login.live.com` — a JS/SPA, bot-protected
consumer flow that challenges datacenter IPs (both our dev container and Vercel
prod). No unattended server-side login (fetch *or* headless browser) reliably
gets past that wall for an MSA account. Automated login is therefore out for v1.

**v1 decision: manual cookie refresh.** An admin logs into my.firstinspires.org
in their own browser, copies the session Cookie, and pastes it into the app. The
app stores that cookie and replays it on every roster/status fetch. The nightly
sync and the data-fetch/parse/match are fully automated; only obtaining the
session is manual. When the session expires, the sync fails loudly and the
dashboard shows "session expired — refresh the FIRST cookie"; the admin re-pastes.

Mechanics that shape the design:
- The auth cookie is **HttpOnly** (verified: `document.cookie` on a logged-in
  page shows only analytics cookies). So the admin cannot copy `document.cookie`
  — they copy the full `Cookie:` **request header** from a logged-in request
  (DevTools → Network → any my.firstinspires.org request → Request Headers →
  Cookie → copy value). The app stores and replays that string verbatim.
- On **save**, the app validates the pasted cookie by test-fetching the roster
  page and confirming `teamContactsModel` is present — instant "works / doesn't"
  feedback, so a bad paste never silently becomes a failing nightly sync.
- Session lifetime is unknown; the design does not assume one. The dashboard
  always shows when the cookie was last refreshed and whether the last sync saw
  an expired session, so the admin knows when to refresh.
- No credentials (username/password) are stored anywhere — not env, not DB, not
  UI. Only the pasted session cookie is stored (in `app_setting`, service-role
  only). `FIRST_USERNAME`/`FIRST_PASSWORD` are NOT used by v1.

Upgrade path if a non-MSA (tenant-native Entra) FIRST admin account ever
exists: the spike's `first-auth.ts` Entra replay (in git history at `f73f8bb`)
would very likely complete unattended with no browser, restoring fully
automatic login. Out of scope for v1.

## Schema (one migration)

New columns on `person`:

| column | type | notes |
| --- | --- | --- |
| `first_people_id` | `integer unique` | FIRST's `peopleId`; once set, sync matches on it exactly |
| `first_consent_release` | `boolean` | from roster `ConsentReleaseStatus` (any-true across roles) |
| `first_screening_status` | `text` | raw color word |
| `first_screening_text` | `text` | actionable message |
| `first_training_status` | `text` | raw color word |
| `first_synced_at` | `timestamptz` | when this row was last touched by a sync |

`app_setting` seeds:

- `first_team_profile_id`: `1790765`
- `first_sync_secret`: per-env secret for the cron header (same pattern as
  `gcal_sync_secret`)
- `first_session`: jsonb `{ cookie, savedAt }`, written when an admin pastes a
  session cookie (starts null)
- `first_last_sync_report`: jsonb, written at the end of each sync (backs the
  unmatched lists on the dashboard; starts null). Also records whether the run
  hit an expired session.

No new tables, so no new grants needed beyond what `person`/`app_setting`
already have.

## Sync engine — `src/lib/first-sync.ts`

`syncFirstRoster()`:

1. **Fetch roster** with the stored cookie from `app_setting.first_session`.
   Missing session → throw `first_not_configured`. Redirect to
   firstcommunity/login (expired cookie) → throw `first_session_expired` (no
   auto-relogin possible; the admin must re-paste).
2. **Parse** `teamContactsModel` out of the HTML (regex/substring to the JSON
   literal, then `JSON.parse`).
3. **Filter** to adult `role_category`s; **dedupe** by `peopleId`, merging
   `ConsentReleaseStatus` as any-true and keeping first-seen name/email/phone.
4. **Fetch statuses** via `GetPersonStatus` with repeated `&ids=` params.
5. **Match** each FIRST person to a `person` row, in order:
   1. existing `first_people_id`;
   2. email (case-insensitive) against `person.email` and `person_identity.email`;
   3. normalized name via the existing `nameKey()` helper (`src/lib/name-match.ts`).
   Never auto-create people.
6. **Update** matched rows (the 5 status/id columns + `first_synced_at`).
7. **Return a report**: `{ matched, updated, unmatchedFirst: [{peopleId,
   name, email}], unmatchedHub: [names of active mentors/admins with no
   first_people_id] }`.

Failures are loud (thrown/reported), never partial-silent. The app never
depends on FIRST being reachable — stale data + visible `first_synced_at` is
the degradation mode.

## Endpoints & cron

- `POST /api/admin/first/sync` — authorized by admin session **or**
  `x-sync-secret` header matched against `app_setting.first_sync_secret`
  (clone of the calendar-sync dual auth). Runs `syncFirstRoster()`, returns
  the report JSON.
- `PATCH /api/admin/first/link` — admin-only; body `{ personId, firstPeopleId }`
  (or `firstPeopleId: null` to unlink). Backs the manual-link picker.
- `POST /api/admin/first/session` — admin-only; body `{ cookie }`. Validates by
  test-fetching the roster with the pasted cookie and confirming
  `teamContactsModel` is present; on success writes `first_session =
  { cookie, savedAt }` and returns `{ ok: true }`; on failure returns 400
  `{ error: "invalid_session" }` and stores nothing.
- **Nightly cron migration**: pg_cron + pg_net POST to a `first_sync_url`
  app_setting with the `x-sync-secret` header — a clone of
  `20260811084653_calendar_cron.sql`, scheduled `0 8 * * *` UTC (≈3–4am
  Eastern).

## UI

- **`/admin/first-status`** (admin-only):
  - **FIRST session card**: shows session state (valid + "last refreshed <when>",
    or "expired/none — refresh needed"). A textarea to paste the `Cookie:` header
    with step-by-step copy instructions (DevTools → Network → a
    my.firstinspires.org request → Request Headers → Cookie), and a Save button
    that POSTs `/api/admin/first/session` and reports validation result inline.
  - Table: one row per active `person` with role mentor/admin. Columns:
    name, Consent & Release, YPP screening, training — colored badges from
    the raw status values (`green`=ok, `orange`=in progress, `blue`/`false`=
    action needed, empty=never synced), screening text as
    subtext/tooltip. Client component, sortable by any column.
  - Below the table: unmatched FIRST entries (name/email from the last sync
    report) each with a person picker that calls the link endpoint; and the
    hub mentors with no `first_people_id`.
  - "Sync Now" button + last-synced timestamp (Drive-sync panel pattern:
    button POSTs the sync route, renders the returned report).
  - The unmatched-FIRST list needs the last report persisted: store it in
    `app_setting.first_last_sync_report` (jsonb) at the end of each sync.
- **Person page**: "FIRST status" card with the three statuses +
  `first_synced_at`. Rendered for admins on anyone; for a non-admin mentor
  only when viewing themselves; never for students (v1).

## Testing

- **Unit** (vitest, fixtures from the captured real data, emails redacted):
  model extraction from HTML, adult filter + multi-role dedupe/merge,
  repeated-ids URL building, match ladder (first_people_id → email →
  identity email → nameKey), report shape.
- `fetchWithSession` / cookie handling is validated live via a manual check
  script (CI can't reach FIRST); its pure cookie-normalization helper is unit-
  tested.
- **E2E** (Playwright): dashboard renders with seeded status columns, sort
  works, manual link flow — sync engine mocked/seeded, no FIRST calls in CI.
- Standard gates before PR: `./dev npm run lint / typecheck / test / e2e`.

## Implementation order

1. Cookie-based FIRST session: rework `first-auth.ts` to store/replay a pasted
   Cookie header; `fetchWithSession(url, cookie)`; manual live check script.
2. Migration (columns + settings + grants check).
3. Sync engine + unit tests (fixtures first).
4. Sync/link/session endpoints + cron migration.
5. Admin dashboard page + FIRST session card + Sync Now + manual link.
6. Person-page card + visibility rules.
7. E2E + prod rollout (`supabase db push`, set `first_sync_url` +
   `first_sync_secret` on prod, admin pastes the FIRST session cookie via the
   dashboard, first manual sync). No FIRST env vars needed in Vercel.
