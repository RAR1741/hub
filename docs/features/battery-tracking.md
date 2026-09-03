# Battery tracking

Team members log individual battery usage per match, and mentors manage the inventory. This replaces
the paper per-match log sheet and the mentor's inventory spreadsheet, keeping a timestamped history of
every battery drawn and its test results.

## Inventory and lifecycle

The **battery** table holds each battery with model, specs (amp-hour rating, serial date code), and
lifecycle status (`active` or `retired`). Batteries are identified by a unique plain-text number
(`2026-01`). Retire is a PATCH operation (no DELETE); retired batteries stay in history with
`retired_at` and `retired_reason` for record-keeping.

## Usage log

The **battery_usage** table records every draw: who logged it (`tech_id`), when (`used_at`), which
battery, the match context (`event_key` TBA-shaped, `match_key` free text), and test results
(wiggle/charger tests, internal resistance, pre/post charge %). Any battery can log a problem with a
description. `/batteries` shows active batteries in least-recently-used order and a form to submit a
usage row; `/batteries/[id]` shows the detail card and per-battery usage history.

## Roles

**Student+** can view batteries and submit usage logs (their name is recorded automatically). **Mentor+**
can create/edit batteries, retire them, and delete a mistyped usage row (the only edit path, by design).

## Pages and access

- `/batteries` — usage log form (active batteries in LRU order), active battery summary table, and
  recent log history. Students see it; mentors also see a "New battery" panel and a collapsed list of
  retired batteries. Student-gated (guests redirect to `/login`).
- `/batteries/[id]` — battery spec card, full usage history, and mentor-only edit controls for notes
  and retirement status.

## Future work

v1 is inventory + usage log only. Not included: bench test records ([#241](https://github.com/RAR1741/hub/issues/241)), rotation
enforcement ([#242](https://github.com/RAR1741/hub/issues/242)), SVN historical import
([#243](https://github.com/RAR1741/hub/issues/243)), .bt2 file uploads to Google Drive
([#244](https://github.com/RAR1741/hub/issues/244)), and other battery types beyond FRC robot
([#245](https://github.com/RAR1741/hub/issues/245)).

## Source

`src/lib/batteries.ts` (core logic, parsing, LRU sort), `src/app/api/batteries/` (CRUD routes),
`src/app/batteries/page.tsx` and `src/app/batteries/[id]/page.tsx` (pages), `src/components/BatteryForm.tsx`,
`UsageLogForm.tsx`, `UsageLogTable.tsx` (UI), and the schema in `supabase/migrations/20260903120000_battery_tracking.sql`.
