# Historical time-sheet import — design

**Status:** approved shape (2026-08-13), pending spec review
**Goal:** Let an admin import years of existing attendance data from the team's Google-Sheets
time trackers (exported to CSV) into Team Hub's `session`/`excusal` model, via an upload screen
that parses, validates, previews, and commits — reusing the roster-importer pattern.

## Context

The team has tracked attendance in a Google Sheet for years (one sheet per season). Each sheet is a
wide, positional grid: one row per person, three columns per meeting (`Time In`, `Time Out`,
`Day Total`), plus derived summary columns. We want that history inside Team Hub so hours,
leaderboards, and attendance percentages reflect it.

**Access decision:** CSV upload (admin exports each sheet to CSV and uploads it). No Google Sheets
API, no service account, no new OAuth scopes — lowest-risk, and it reuses the existing roster-import
UX (`/admin/people/import`, `src/lib/roster-import.ts`).

## Non-goals

- Reading sheets live via the Google API (rejected in favor of CSV upload).
- Importing the derived columns (`Hours Left`, `Day Total`, `Total Hours`, `Points`,
  `% Required`, `Total %`, `Hours Required`, `Varsity`, `Letter`) — all recomputed by existing
  features from the raw sessions.
- Merging duplicate people created by name typos — deferred to **issue #33**.

## Source format (observed from `Hub Time Import - 2026 - Build Season.csv`)

Structure is detected by **content**, never by fixed row/column numbers — other seasons have
different section sizes and lengths.

**Columns**
- `[0]` First name, `[1]` Last name, `[2]` `Hours Left` (ignored).
- Then repeating **3-column blocks**, one per meeting, starting at column index `3`, stride `3`:
  `(Time In = c, Time Out = c+1, ignored = c+2)`. The ignored third column is `Verified` for the
  first block and `Day Total` for the rest — ignored uniformly either way.
- The **date** for block starting at column `c` comes from the **date row** cell at `c`
  (e.g. `January 8, 2026`).
- Blocks end when the date-row cell at the next stride-3 position is not a parseable date; the
  far-right summary columns (no date above them) fall outside and are excluded automatically.

**Rows** (top to bottom, counts vary per sheet)
- Header band: a **date row** (stride-3 cells parse as dates) and a **sub-header row** below it
  (`Name`, `Time In`, `Time Out`, `Day Total`, …). Plus decorative rows (day-of-week labels,
  `Meeting before Kickoff`) that are ignored.
- **Data rows**: any row with **both first and last name non-empty**.
- Skipped automatically: blank template rows (no name), reference rows (`Available Time`, `60%er`,
  `Full Time` — these have an empty *first-name* cell), and blank spacer rows.

**Messy realities the parser must handle** (all seen in the 2026 file)
- Mixed time formats in the same sheet: `18:29`, `9:00 AM`, `6:26:00 PM`, `21:25:00`,
  `5:56:26 PM`, and bare ambiguous `5:56`.
- `Excused` (sometimes trailing-space `Excused `) in a Time-In cell = excused absence that day.
- Time-In present, Time-Out empty (forgot to clock out).
- Overnight sessions: Time Out earlier than Time In (e.g. `9:22 → 0:12`), a real long-build-day case.

## Data model & writes

Attendance lands in the existing tables:

- **`session`** — `person_id`, `period_id`, `time_in timestamptz`, `time_out timestamptz`,
  `source`, `excluded_from_totals`. Hours are always derived from `time_in`/`time_out`; no total is
  stored. A partial unique index enforces **one open (null-`time_out`) session per person** — not a
  concern here because every imported session has both ends (open ones are skipped).
- **`excusal`** — PK `(person_id, date)`, `note`, `created_by`.

**Migration** (`supabase/migrations/<ts>_time_import_source.sql`, migrations-as-code):
1. Extend `session.source` check to `('kiosk','manual','admin','import')`.
2. **Add `source` to `excusal`**: `source text not null default 'manual' check (source in
   ('manual','import'))`. Rationale: excusal has no way to tell an import-created row from a
   mentor-entered one, so idempotent replace (below) needs this marker. Existing rows/flows default
   to `'manual'`. *(Decision point — see Open decisions.)*

**What each cell becomes**
- Valid Time In **and** Time Out → one `session` `{ person_id, period_id, time_in, time_out,
  source:'import' }`. `edited_by`/`edited_at`/`note` left null (imported rows are not "edited", so
  they never show on the flagged screen).
- `Excused` in the Time-In cell → one `excusal` `{ person_id, date, source:'import', created_by:
  <importing admin> }`, inserted `on conflict (person_id,date) do nothing` so a pre-existing manual
  excusal is never overwritten.
- Time In only (no Out) → **skipped**, listed in the summary.
- Both empty → plain absence, no row, not reported.

**Timezone.** Sheet times are team-local wall-clock. A `localDateTimeToInstant(date, hhmm, tz)`
helper (new, unit-tested) converts `(column date, resolved clock time, team `timezone` app_setting)`
→ `timestamptz`. Overnight roll (below) is applied before conversion.

## Parsing — `src/lib/time-import.ts` (pure, no DB)

`parseTimeSheet(csvText): ParsedTimeSheet` returns a structured, DB-free result:

```
ParsedTimeSheet = {
  dates: string[];                     // ISO dates, one per block, in column order
  people: ParsedPerson[];
  fileIssues: string[];                // e.g. "no date row found", "no data rows"
}
ParsedPerson = {
  firstName: string; lastName: string; sourceRow: number;
  sessions: { date: string; timeIn: string; timeOut: string }[];  // resolved 24h HH:MM, timeOut may be next-day
  excusals: { date: string }[];
  skipped:  { date: string; reason: string }[];   // e.g. "missing clock-out"
  anomalies: TimeAnomaly[];            // surfaced, not dropped
}
TimeAnomaly = { date: string; kind: 'time_far_from_column' | 'over_max_shift' | 'zero_or_negative';
                detail: string }
```

Reuses the RFC-4180-ish tokenizer from `roster-import.ts` (extract to a shared `csv.ts` so both
importers share one tokenizer). Structure detection:
1. Find the **date row** = first row whose stride-3 cells (from col 3) yield ≥ 3 parseable dates.
2. `dates[]` = those parsed dates until the first non-date at a stride-3 position.
3. Data rows = subsequent rows with both name cells non-empty (reference/blank/spacer rows drop out).

## Smart time parsing (two-pass, per column)

The two passes run **independently on the Time-In and Time-Out sub-columns** (each has its own
consensus — clock-ins cluster around one time, clock-outs around another). Per sub-column, across
all people:
- **Pass 1 — confident parse.** Parse each non-empty, non-`Excused` cell across the known formats
  (`HH:MM`, `H:MM`, `HH:MM:SS`, with optional `AM`/`PM`). "Confident" = had explicit AM/PM, or a
  24-hour hour > 12. Collect confident clock-times → **column median** (people clock into a given
  meeting at roughly the same time).
- **Pass 2 — resolve + flag.** For **ambiguous** cells (bare `h:mm`, hour ≤ 12, no AM/PM), choose
  the AM or PM interpretation **closest to the column median**. Any cell still more than
  `TIME_ANOMALY_THRESHOLD` (default **4 h**, a named tunable constant) from the median is kept as
  best-guess and recorded as a `time_far_from_column` anomaly.
- **Overnight roll.** If Time Out's resolved clock value < Time In's, Time Out is on the **next
  calendar day**. The session belongs to the **start day**; all its hours count there (Kevin in
  Fri 18:00 / out 01:00 = 7 h on Friday, none Saturday).
- **Duration checks.** After roll: a duration over `max_shift_hours` (existing setting, 18 h) →
  `over_max_shift` anomaly (still imported — long build days are real); a zero/negative duration →
  `zero_or_negative` anomaly.

Anomalies never block the import; they appear in the preview so the admin can correct the source and
re-import (which is idempotent).

## People — match, else auto-create — `src/lib/time-import-run.ts` (impure, injectable `db`)

- **Match**: `lower(first_name)+lower(last_name)` against the roster, also matching a person whose
  `lower(display_name)` equals `first last`. Exactly one match → use it.
- **Ambiguous** (name matches ≥ 2 people) → reported as an error row, not imported.
- **No match** → **auto-create** a `person` `{ first_name, last_name, role:'student', is_active:true }`
  (no email/ID — the sheet carries none). Every auto-created person is listed in the summary for a
  one-pass role review. (Role is *not* inferred from sheet sections — too brittle.)

## Idempotency

A re-import of the same period is a clean **replace**, scoped by `source='import'`:
1. `delete from session where period_id = :p and source = 'import'`.
2. `delete from excusal where source = 'import' and date between :period.starts_on and :period.ends_on`.
3. Batch-insert the freshly parsed sessions and excusals.

Kiosk/manual/admin sessions and manual excusals are never touched. Auto-created people persist
across re-imports (a second run matches them by name — no duplicates).

## UI / UX

- **Screen** `/admin/time-import` (admin-gated; linked from the `/admin` hub, Roster or Time
  section). Controls: a **target-period** `<select>` (required) and a file input.
- **Preview** (client parses for display only): total people (matched / to-be-created), sessions to
  import, excusals, skipped entries (with reasons), and **anomalies** — each grouped and expandable.
  Dates falling outside the selected period's `[starts_on, ends_on]` are flagged here too (likely
  wrong-period selection).
- **Commit**: `POST /api/admin/time-import` (admin-gated) receives the **raw CSV text** + `periodId`,
  **re-parses server-side** (never trusts the client preview), runs matching/auto-create + the
  idempotent replace, and returns a summary: `{ createdPeople, matchedPeople, sessions, excusals,
  skipped[], anomalies[], errors[] }`.
- Reuses existing component classes (cards, tables, pills, status regions) per the UI system.

## Error handling

- File-level problems (`no date row found`, `no data rows`, unreadable CSV) → `400` with a clear
  message; nothing is written.
- Per-row/-cell problems (ambiguous name match, unparseable date) → collected into `errors[]`/
  `skipped[]` and returned; they don't abort the rest of the import.
- The whole commit runs as one logical unit; a mid-import DB error surfaces as `500` with the
  partial summary, and because writes are an idempotent replace, re-running after a fix is safe.

## Testing

- **`time-import.test.ts`** (pure) — a fixture built from the real messy rows: 24h/12h/seconds/
  ambiguous times, `Excused`/`Excused `, missing clock-out, overnight roll, reference & blank rows,
  a short (few-column) season, and a wrong-format outlier that must surface as an anomaly. Assert
  parsed sessions/excusals/skips/anomalies and dynamic structure detection.
- **`localDateTimeToInstant` tests** — local wall-clock + tz → correct UTC instant, incl. overnight.
- **`time-import-run.test.ts`** (fake `db`) — match, ambiguous→error, no-match→auto-create,
  idempotent replace deletes only `source='import'`, batch insert shape.
- **E2E** — upload the sample CSV as admin, assert the preview counts and a committed session/
  excusal; assert non-admins are redirected.

## Open decisions (for spec review)

1. **`excusal.source` column** — adding it is the clean way to make excusal imports idempotent and
   non-clobbering. Alternative: don't touch `excusal`; insert excusals `on conflict do nothing` and
   *never* delete them on re-import (removing an `Excused` from the sheet then wouldn't un-excuse).
   Proposed: **add the column.**
2. **`TIME_ANOMALY_THRESHOLD`** default of 4 h — catches AM/PM (12 h) and timezone (~5 h) errors
   without flagging normal late arrivals. Tunable constant.
3. **Auto-created role** defaults to `student`, flagged for review (not inferred from sheet
   sections). Confirmed in brainstorming.

## Deferred

- **Person merge** (find & merge close names) — issue #33. The natural cleanup tool for auto-create
  typos; out of scope here.
