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

### Authentication

Login is Azure AD B2C (`firstcommunity.firstinspires.org`, OIDC
`response_mode=form_post`). No CAPTCHA/bot-protection observed on the login
page. Expired/missing session is detectable: the data URL redirects (302) to
the B2C authorize endpoint.

**Decision: HTTP replay, spiked first.** Implementation task #1 is a
throwaway spike proving login end-to-end in the real runtimes (local
container, then a Vercel preview function): replay the B2C `SelfAsserted`
flow with plain fetch — GET authorize page, parse CSRF token + transaction
id, POST credentials to `SelfAsserted`, follow `confirmed`, complete the
`form_post` back to my.firstinspires.org, capture the resulting cookie jar.
No browser, runs anywhere. Brittle if FIRST changes B2C config — acceptable
because failure just stops syncing (data goes stale, sync reports the error;
nothing else breaks). If the spike proves replay infeasible, stop and
re-decide (fallback: Playwright + headless Chromium in the Vercel function).

Credentials live in **env vars**: `FIRST_USERNAME`, `FIRST_PASSWORD`
(Vercel envs + local `.env`). Never in the DB, never in any UI.

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
- `first_session_cookies`: jsonb cookie jar, written by the sync itself
  (starts empty)
- `first_last_sync_report`: jsonb, written at the end of each sync (backs the
  unmatched lists on the dashboard; starts empty)

No new tables, so no new grants needed beyond what `person`/`app_setting`
already have.

## Sync engine — `src/lib/first-sync.ts`

`syncFirstRoster()`:

1. **Fetch roster** with cached cookies from `app_setting.first_session_cookies`.
   On redirect to B2C (or missing cookies): re-login via HTTP replay, store
   the new jar, retry once. A second failure aborts with a clear error.
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
- **Nightly cron migration**: pg_cron + pg_net POST to a `first_sync_url`
  app_setting with the `x-sync-secret` header — a clone of
  `20260811084653_calendar_cron.sql`, scheduled `0 8 * * *` UTC (≈3–4am
  Eastern).

## UI

- **`/admin/first-status`** (admin-only):
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
- **Login spike** is validated live, not unit-tested; the replay code keeps
  one integration self-check script (run manually) since CI can't reach FIRST.
- **E2E** (Playwright): dashboard renders with seeded status columns, sort
  works, manual link flow — sync engine mocked/seeded, no FIRST calls in CI.
- Standard gates before PR: `./dev npm run lint / typecheck / test / e2e`.

## Implementation order

1. **Login spike** (throwaway): prove B2C HTTP-replay login + cookie capture
   from the local container, then from a Vercel preview function. Gate: raw
   roster HTML retrieved in both. If infeasible → stop, re-decide.
2. Migration (columns + settings + grants check).
3. Sync engine + unit tests (fixtures first).
4. Sync/link endpoints + cron migration.
5. Admin dashboard page + Sync Now + manual link.
6. Person-page card + visibility rules.
7. E2E + prod rollout (env vars in Vercel, `supabase db push`, set
   `first_sync_url` + `first_sync_secret` on prod, first manual sync).
