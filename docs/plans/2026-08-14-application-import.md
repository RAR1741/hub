# Student Application Import — Implementation Plan

**Goal:** Import Google Forms "Student Application" CSV responses (2022–2027, one
file per season) into the roster: enrich `person`, populate a new many-to-many
`guardian` model, and record prior-FIRST experience in a queryable table.

**Approach:** Mirror the time-sheet importer's shape — pure parse lib → runner
with mandatory dry-run preview → admin-gated API route → forced-preview form —
reusing its person matcher and decisions pattern. One migration adds the schema.

**Decisions locked in (from review):**
- Keep: DOB, address (street/city/zip), school, demographics (ethnicity, race),
  interests, guardians, prior-FIRST experience. Drop: essays/survey answers,
  "how did you learn", "Attended Call Out?" (2022 only), home phone,
  Radical Robot Camp (yes/no only — no year data to store).
- Guardians: own table, **many-to-many** (a student has ≤2 guardians; siblings
  share one). Relationship ("Mother"/"Father"/…) lives on the join row.
- Experience: own table — person, level, year, game name.
- Dedup: normalized name (partial-match capable) + DOB; **latest response wins**.
- Post-import: anyone with `grad_year` ≤ 2026 becomes inactive.

---

## Schema (Task 1)

`supabase/migrations/<ts>_application_import.sql`:

```sql
-- Application-sourced person enrichment. All nullable: pre-existing rows and
-- people who never applied simply lack them.
alter table person
  add column date_of_birth date,
  add column street_address text,
  add column city text,
  add column zip text,
  add column school text,
  add column ethnicity text,
  add column race text,
  add column interests text[],
  -- Timestamp of the newest application response applied to this row.
  -- The importer only overwrites when the incoming response is newer, which
  -- makes imports idempotent and order-independent ("latest wins").
  add column last_application_at timestamptz;

-- A parent/guardian. Shared across siblings: the importer matches existing
-- guardians by normalized name + (email or phone) before creating one.
create table guardian (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  employer text,
  updated_at timestamptz not null default now()
);

-- Many-to-many: relationship is per (student, guardian) pair.
create table person_guardian (
  person_id uuid not null references person (id) on delete cascade,
  guardian_id uuid not null references guardian (id) on delete cascade,
  relationship text,
  primary key (person_id, guardian_id)
);

-- Prior FIRST participation, one row per (person, program level, season year).
-- name is the game/challenge name ("Rapid React", "Relic Recovery").
create table first_experience (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  level text not null check (level in ('fll_explore', 'fll_challenge', 'ftc', 'frc')),
  year int not null,
  name text,
  unique (person_id, level, year)
);

alter table guardian enable row level security;
alter table person_guardian enable row level security;
alter table first_experience enable row level security;
-- House pattern: default-deny, no policies; all access via service role.
```

Notes:
- `fll_explore` vs `fll_challenge` kept distinct (the forms distinguish them);
  collapsing to "FLL" later is a query-time choice.
- Validate with `BEGIN; \i file; ROLLBACK;` then `supabase migration up`,
  then full `db reset` (seed compatibility).

Also extend `PersonRow`/`Person`/`personFromRow` in `src/lib/types.ts`, plus new
`GuardianRow`/`FirstExperienceRow` types + mappers, with `types.test.ts` cases.

## Parsing (Task 2) — `src/lib/application-parse.ts` (pure)

Reuses `parseCsvRecords` from `src/lib/csv.ts`.

**Header mapping, not positions.** Columns move between years (email is col 12
in 2022 but col 4 in 2023) and appear/disappear (race/ethnicity 2024+, guardian
employer 2027+). Map by matching the full header text against canonical
snippets, e.g.:

| Field | Header match |
|---|---|
| firstName / preferred / lastName | `first name` / `preferred name` / `last name` |
| dob | `date of birth` |
| gradYear | `graduation year` |
| school | starts `what school are you attending` (also yields **season year** from "20XX-20YY School Year" → YY) |
| street/city/zip | `street address` / `city` / `zip code` |
| cellPhone | `cell phone number` (first non-guardian occurrence) |
| email | `email address` (first non-guardian occurrence) |
| shirtSize | `t-shirt size` |
| ethnicity / race | `your ethnicity` / `your race` |
| interests | `items of interest` (split on commas — values are a fixed vocabulary without embedded commas) |
| experience ×4 | `participated as a student in fll explore` / `fll challenge` / `ftc` / `frc` |
| guardian 1 | `parent/guardian first name`, `…last name`, `…relationship`, `…cell phone`, `…email address`, `place of employment` |
| guardian 2 | headers containing `parent/guardian 2` (quirk: G2 last name header is just "Parent/Guardian 2"; G2 first name is "Parent/Guardian 2 (if applicable)") |
| dietary (2025 quirk) | the single **unlabeled** trailing column in 2025 holds allergy text → map to existing `dietary_restrictions` |
| timestamp | `timestamp` |

**Experience entries:** each cell is comma-separated `"2017-2018 Relic Recovery,
2022 Rapid React"`. Parse with `/(\d{4})(?:-(\d{4}))?\s+(.*)/` per entry → year =
range's second year (else the single year), name = remainder. Unparseable
entries → anomaly, not a crash.

**Normalization:** trim everything; phone → digits-only (strip punctuation),
empty/`N/A`/`n/a` → null; DOB `M/D/YYYY` → ISO, flag implausible years
(< 1980 or > season−10, e.g. the real `9/19/0006`) as anomalies with the raw
value preserved in the preview; gradYear must be 4-digit int.

**Encoding:** decode as UTF-8; the files contain some CP-1252 mojibake (`I�m`)
in essay fields we don't import — no special handling needed for kept fields,
but parsing must not throw on replacement chars.

Output: `ParsedApplication[]` + `seasonYear` + anomalies. **In-file dedup:**
key = `nameKey(first,last) + "|" + (dob ?? "")`, keep the row with the newest
timestamp (people occasionally double-submit).

Tests: fixture header rows lifted verbatim from all six real years (drift
matrix), experience parsing (range year, single year, garbage), guardian-2
header quirk, 2025 unlabeled dietary column, phone/DOB normalization, dedup
keeps-newest.

## Matching & merge (Task 3) — `src/lib/application-import-run.ts`

`runApplicationImport({ csvText, dryRun, decisions, confirm })`, following
`time-import-run.ts` conventions (summary object, decisions map, no writes on
dry-run, **undecided check before any write**).

**Match an applicant to existing people** (roster loaded once; indexes reuse
`nameKey`/`normalizeFull` from the time importer):
1. Exact: `nameKey(first,last)` or `normalizeFull(preferred + last)` or
   normalized-email index → single candidate = **auto-match**; multiple = needs
   decision.
2. Fuzzy (the "partial match" case): same normalized last name AND (first-name
   prefix either direction, or applicant's preferred name equals the person's
   first/display name). Fuzzy candidates are **never auto-linked** — they
   surface in the preview as a decision: `link:<personId>` / `create` / `skip`.
3. No candidates → create (role `student`, `is_active` per grad-year rule).

Decision keys: `first|last|dob` (mirrors the time importer's `anomalyKey`).

**Latest wins:** skip the applicant entirely (counted as `stale`) when the
target person's `last_application_at` ≥ response timestamp. Otherwise overwrite
the application-owned fields (names/preferred → `display_name` only when it
differs from first name, dob, gradYear, school, address, phone, email, shirt,
ethnicity, race, interests, dietary if present) and set `last_application_at`.
Fields the forms don't own (`student_id_number`, `role`, `bio`, `avatar_path`)
are never touched. A matched **mentor/admin** is never role-changed; flagged in
preview as a callout (same spirit as the time importer's role-change gate).

**Experiences:** on write, `delete from first_experience where person_id = X`
then insert the parsed set (replace-wholesale; the newest application's list is
the freshest self-report).

**Guardians:** global index of existing guardians by
`nameKey(first,last)` + contact (`email` OR `phone` digit-match). Match → update
contact/employer fields (latest wins by the same timestamp rule, using
`guardian.updated_at`), else insert. Then upsert `person_guardian` with
relationship. Two guardians on one form = two link rows; a sibling importing
later links to the same guardian row.

**Deactivation sweep** (end of every confirmed run):
```
update person set is_active = false where grad_year < :currentSeasonYear;
update person set is_active = true  where grad_year >= :currentSeasonYear and id in (:touched);
```
`currentSeasonYear = month >= June ? year + 1 : year` (Aug 2026 → 2027, so
grad ≤ 2026 goes inactive — the requested rule, and it stays correct next year).
Only applicants touched by this run are re-activated; the sweep never
re-activates alumni.

**Preview summary** (dry-run): counts + lists for created people, auto-matched
(with per-field old→new diffs), fuzzy candidates awaiting decision, stale-
skipped, guardians created/matched, experience rows, anomalies (bad DOB etc.),
mentor-name collisions, and the would-deactivate count.

Tests: fake-db runner tests — auto-match by name/email, fuzzy needs-decision
(link/create/skip each), ambiguous exact match, latest-wins staleness both ways,
experience replace, guardian sibling-sharing + contact update, deactivation
math at the June boundary, undecided-blocks-write.

## API route (Task 4) — `src/app/api/admin/application-import/route.ts`

`withRole("admin")`, multipart/form or JSON body `{ csv, confirm?, decisions? }`.
Default **dry-run**; writes only when `confirm === true` and no undecided
fuzzy matches (server-enforced, mirroring `undecided_anomalies`). Sanitize
decisions to `link:<uuid> | create | skip`.

## UI (Task 5) — `/admin/application-import`

Page + `ApplicationImportForm.tsx`, modeled on `TimeImportForm`:
- File picker → server dry-run → preview sections (created / matched-with-diffs
  / decisions needed / guardians / anomalies / deactivations).
- Fuzzy matches render as radio rows: "Link to <existing name>" / "Create new" /
  "Skip".
- Import button disabled until a preview ran on the current file AND every
  decision is made (`importReady && allDecided` — same gate as time import).
- Card on `/admin` next to the time-import card.

E2E: admin gate redirect (non-admin), fixture-CSV import round trip asserting
the preview renders and a confirmed import reports created people.

## Execution order & verification

1. Migration + types (validate: rollback-`\i`, `migration up`, `db reset`, unit).
2. `application-parse.ts` + tests (vitest in-container).
3. `application-import-run.ts` + tests.
4. Route.
5. UI + e2e.
6. Full suites (`npm test`, `npm run e2e`), commit per task, push each commit.

Then the real backfill (manual, after review): import 2022 → 2027 in order via
the UI against local first, spot-check, then prod. Order doesn't matter for
correctness (latest-wins is timestamp-based) but chronological is easiest to
review.

## Out of scope (explicitly)

- Essay/survey answers, "how did you learn", call-out attendance, home phone,
  Radical Robot Camp flag — dropped per review.
- Guardian UI (viewing/editing guardians on person pages) — data lands in
  tables; surfacing it is a follow-up feature.
- Mentor applications (different form, if any) — student forms only.
