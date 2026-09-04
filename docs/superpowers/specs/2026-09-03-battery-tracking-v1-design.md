# Battery tracking v1 — design

Status: accepted 2026-09-03

## 1. Problem and decisions

Replace the paper per-match battery log sheet (Plainfield 2024) and the mentor's inventory
spreadsheet with two tables and two pages. v1 = **inventory + usage log**. Nothing else.

Decisions already made (do not re-open):

1. **Two tables, one migration** `supabase/migrations/20260903120000_battery_tracking.sql`:
   `battery` and `battery_usage`. No event/competition table; event and match are text keys in
   The Blue Alliance shape (`2026incol`, `qm1`).
2. **Battery number is plain unique text** (`2026-01`), not derived from year acquired.
3. **Lifecycle = `active | retired`** with `retired_at` / `retired_reason`. Retire is a PATCH,
   not a route. `retired_at` is client-settable (default now) so a hand-entered historical
   battery can record its scrap year. No third state.
4. **`kind text default 'frc_robot'`** with a one-value check is the extension point for other
   battery types. Nothing reads it in v1.
5. **`match_key` is free text** (≤ 20 chars, trimmed, case kept): `qm1`, `sf1m1`, `Prac 4`,
   `P7` all valid. `event_key` is lowercased and loosely TBA-shaped (`^\d{4}[a-z0-9]+$`) so a
   later TBA lookup works; both nullable (shop/pit tests have no event).
6. **Roles.** View + log usage: student+ (guests redirect/403). Create/edit/retire batteries and
   delete a usage row: mentor+. `tech_id` is always `viewer.person.id`, never from the body.
   `battery_usage` has exactly one `person` FK.
7. **No battery DELETE.** Retire instead; `on delete restrict` keeps history.
8. **LRU nicety** on the log form: active batteries ordered never-used first, then least
   recently used. One embedded query + JS sort. No flagging, no enforcement.
9. **`merge_person()` must learn the new FK.** The function
   (`20260816120000_merge_people.sql`) is a hardcoded list of `update … set col = p_winner`
   statements; a person FK it does not know makes merging that person fail with 23503.
   The migration re-declares it with `update battery_usage set tech_id = p_winner where
   tech_id = p_loser;` added before `delete from person`. (Pre-existing gap: `event`,
   `badge`, `badge_award`, `form`, `event_signup` were never added either — tracked as a
   separate task, not fixed here.)

## 2. Schema

```sql
create table battery (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,                       -- e.g. '2026-01'; user-entered
  kind text not null default 'frc_robot' check (kind in ('frc_robot')),
  year_acquired integer,
  model text,                                        -- NP18-12B
  serial_date_code text,                             -- YQ24F
  manufacturer text,                                 -- Enersys
  trade_name text,                                   -- Genesis
  amp_hour_rating numeric,                           -- 17.2
  notes text,
  status text not null default 'active' check (status in ('active', 'retired')),
  retired_at timestamptz,
  retired_reason text,
  created_at timestamptz not null default now(),
  check ((status = 'retired') = (retired_at is not null))
);
alter table battery enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on battery to service_role;

create table battery_usage (
  id uuid primary key default gen_random_uuid(),
  battery_id uuid not null references battery (id) on delete restrict,
  tech_id uuid not null references person (id) on delete restrict,  -- submitter
  used_at timestamptz not null default now(),
  event_key text,                                    -- TBA event key, nullable
  match_key text,                                    -- 'qm1' or free text 'Prac 4'
  had_problem boolean not null default false,
  problem_description text,
  wiggle_test_ok boolean,                            -- null = not recorded
  charger_test_ok boolean,
  rint_ohms numeric,                                 -- 0.018
  charge_pre_pct integer check (charge_pre_pct >= 0),
  charge_post_pct integer check (charge_post_pct >= 0),  -- may exceed 100
  notes text,
  created_at timestamptz not null default now(),
  check (had_problem or problem_description is null)
);
create index battery_usage_battery_used_idx on battery_usage (battery_id, used_at desc);
alter table battery_usage enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on battery_usage to service_role;

-- create or replace function merge_person(...) : existing body verbatim, plus
--   update battery_usage set tech_id = p_winner where tech_id = p_loser;
-- grant execute on function merge_person(uuid, uuid) to service_role;
```

`src/lib/types.ts` gains `BatteryRow`/`Battery`/`batteryFromRow` and
`BatteryUsageRow`/`BatteryUsage`/`batteryUsageFromRow` following `PartRow`/`partFromRow`.
`BatteryUsage` carries `tech: { firstName, lastName, displayName }` from the embed.

## 3. Library: `src/lib/batteries.ts` (new)

```ts
parseBatteryInput(body): BatteryInput | null      // POST and PATCH share it (full replace, like updateEvent)
parseUsageInput(body): UsageInput | null
createBattery(input, db?)       → { ok: true; id } | { ok: false; status }
updateBattery(id, input, db?)   → { ok: true } | { ok: false; status }
listBatteries(db?)              → (Battery & { lastUsedAt: string | null })[]   // LRU order
getBattery(id, db?)             → Battery | null
listUsage({ batteryId?, limit }, db?) → BatteryUsage[]   // used_at desc, embeds person
createUsage(input, techId, db?) → { ok: true; id } | { ok: false; status }
deleteUsage(id, db?)            → { ok: true } | { ok: false; status }
sortByLastUsed(rows)            // PURE, exported for tests
```

`mapWriteError`: 23503 → 400, 23505 → 409, else 500 (copy from `parts.ts`).

`listBatteries` is the single LRU query:
`.from("battery").select("*, battery_usage(used_at)").order("used_at", { referencedTable:
"battery_usage", ascending: false }).limit(1, { referencedTable: "battery_usage" })`, then
`sortByLastUsed`: never-used first, then ascending `lastUsedAt`, retired last. Fallback if the
embed-limit misbehaves: two selects plus a reduce; the ordering stays.

`listUsage` embeds `person (first_name, last_name, display_name)`; one FK, no hint needed.
Render names with the existing `displayName()` from `src/lib/people.ts`.

## 4. Validation (`parse*Input`, pure)

BatteryInput: `number` reqString ≤ 20; `yearAcquired` optInt 1990..2100; `model`,
`serialDateCode`, `manufacturer`, `tradeName` optString ≤ 80; `ampHourRating` optional finite
number 0 < x ≤ 1000; `notes` optString ≤ 2000; `status` `'active' | 'retired'`; `retiredAt`
optional ISO date (parsed like `startsAt` in `parseEventInput`); `retiredReason` optString
≤ 500. If `status === 'retired'`, `retiredAt` defaults to now; if `'active'`, both retired
fields are forced null. No `kind` field in v1 input.

UsageInput: `batteryId` reqUuid; `usedAt` optional ISO, default now; `eventKey` optString
≤ 20, lowercased, must match `^\d{4}[a-z0-9]+$` when present; `matchKey` optString ≤ 20 (trim
only); `hadProblem` boolean (default false); `problemDescription` optString ≤ 1000, forced
null when `hadProblem` is false; `wiggleTestOk`, `chargerTestOk` optional boolean; `rintOhms`
optional finite number 0..10; `chargePrePct`, `chargePostPct` optInt 0..999; `notes`
optString ≤ 2000. Any present-but-invalid field → null (whole body rejected, 400).

## 5. API (member-facing, under `src/app/api/batteries/`)

| Route | Role | Body → Response |
| --- | --- | --- |
| `POST /api/batteries` | mentor | BatteryInput → `201 { id }`; 400 invalid; 409 duplicate number |
| `PATCH /api/batteries/[id]` | mentor | BatteryInput (full) → `200 { ok: true }`; 400; 404 no row; 409 |
| `POST /api/battery-usage` | student | UsageInput → `201 { id }`; 400 invalid / unknown battery (23503) |
| `DELETE /api/battery-usage/[id]` | mentor | → `200 { ok: true }`; 404 |

All via `withRole(...)` (masquerade write-block comes free). `POST /api/battery-usage` passes
`viewer.person!.id` as tech; `getViewer()` only assigns a non-guest role when a person row
exists, so the assertion is safe (same as the admin routes). No GET routes; pages render
server-side. `DELETE` exists because there is no edit path for a mistyped entry.

## 6. Pages and components

- `src/app/batteries/page.tsx` (student+, `redirect("/login")` like `/shop`): **Log usage**
  form at top (`UsageLogForm`, battery `<select>` in LRU order, active only); table of active
  batteries (number, model, Ah, last used, link to detail); mentor-only `<details>` "New
  battery" (`BatteryForm`) like `/admin/events`; **Recent log** (`UsageLogTable`, last 50);
  retired batteries in a collapsed `<details>`.
- `src/app/batteries/[id]/page.tsx` (student+): spec card; per-battery `UsageLogTable`;
  mentor-only `BatteryForm` in edit mode (status/retire fields live here).
- `src/components/BatteryForm.tsx` — create + edit (`initial?: Battery`), POST/PATCH, inline
  409 "Number already exists". Edit mode prefills `retiredAt` from `initial.retiredAt` so
  editing notes on a retired battery does not move its retirement date.
- `src/components/UsageLogForm.tsx` — fields per §4; `datetime-local` for `usedAt` (default
  now); problem description shown only when Problems = yes; `router.refresh()` on success.
- `src/components/UsageLogTable.tsx` — rows: used at, battery (link), event/match, pre/post %,
  Rint, tests, problem, tech, notes; `canDelete` prop renders a Delete button (mentor).
- Nav: `SiteNav.tsx` Shop floor group, `isStudent`-gated `NavLink href="/batteries"`, plus a
  More-sheet entry on mobile. Not in `ADMIN_ITEMS` (so `e2e/authz.spec.ts` is untouched). Add
  a `battery` glyph to `src/components/ui/Icon.tsx` (one path entry).

## 7. Tests

Unit `src/lib/batteries.test.ts` (QueryStub pattern from `parts.test.ts`):
- `parseBatteryInput`: valid; empty number; `retired` without `retiredAt` → now; `active`
  clears retired fields; bad year.
- `parseUsageInput`: `eventKey` lowercased and shape-checked (`2026INCOL` → `2026incol`,
  `incol` rejected); `matchKey` `Prac 4` kept verbatim; `chargePostPct: 130` accepted;
  `problemDescription` dropped when `hadProblem` false; non-uuid battery rejected.
- `createBattery` 23505 → 409; `createUsage` 23503 → 400; `sortByLastUsed` never-used first,
  then oldest, retired last.

E2E `e2e/batteries.spec.ts`: mentor `page.request.post("/api/batteries")` → 201; duplicate →
409; student cookie: `/batteries` shows the battery, submit the log form, row appears with
the student's name; student `POST /api/batteries` → 403; guest `/batteries` → `/login`.
`finally`: delete the usage row and PATCH the battery to `retired` so local runs do not
accumulate active `E2E …` batteries (there is no battery DELETE by design).

## 8. Tasks (each sized for a fresh subagent)

1. **coder** — Migration `supabase/migrations/20260903120000_battery_tracking.sql` (§2,
   including the `merge_person` re-declaration) and types in `src/lib/types.ts`. Run
   `./dev npm run db:reset` to verify.
2. **coder** — `src/lib/batteries.ts` (§3, §4) + `src/lib/batteries.test.ts` (§7 unit).
3. **coder** — Routes: `src/app/api/batteries/route.ts`, `src/app/api/batteries/[id]/route.ts`,
   `src/app/api/battery-usage/route.ts`, `src/app/api/battery-usage/[id]/route.ts` (§5).
4. **coder** — Components `BatteryForm.tsx`, `UsageLogForm.tsx`, `UsageLogTable.tsx` and
   pages `src/app/batteries/page.tsx`, `src/app/batteries/[id]/page.tsx` (§6). Verify in
   browser as student and mentor.
5. **mechanic** — `src/components/SiteNav.tsx` (sidebar + More sheet entries) and
   `src/components/ui/Icon.tsx` `battery` glyph (§6).
6. **coder** — `e2e/batteries.spec.ts` (§7 e2e) using `e2e/helpers/session.ts`.
7. **mechanic** — `docs/features/battery-tracking.md` (short, like
   `docs/features/team-external-accounts.md`) and a bullet under "Parts / shop" in
   `docs/features.md`. Run `graphify update .`.

Gates before PR: `./dev npm run lint`, `typecheck`, `test`, `e2e`.

## 9. Non-goals and extension points

- **Bench tests (.bt2)** — future `battery_test` table keyed on `battery_id`.
- **Uploads / Google Drive** — none; a future `battery_test.file_url`.
- **SVN import** — writes through `createBattery`/`createUsage`; historical retirements use
  the client-settable `retiredAt`.
- **Rotation flagging/enforcement** — reads the same `lastUsedAt` embed; no schema change.
- **Other battery kinds** — new migration widening the `kind` check.
- **TBA integration** — `event_key`/`match_key` already TBA-shaped; a lookup or `event` FK is
  a later migration, no data rewrite.
