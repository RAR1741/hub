# Hours, attendance & dietary CSV exports

`/admin/reports` (mentor+, also linked from `/admin` and as an **Export CSV** button on
`/leaderboard`) shows three tables, each with its own **Export CSV** button: dietary restrictions,
hours (for a selected period), and attendance summary (for the same period).

## CSV encoding

Every export goes through `toCsv` (`src/lib/reports-export.ts`) — RFC-4180-ish: a field is quoted
when it contains a comma, quote, or newline, embedded quotes are `""`-escaped, and lines end
`\r\n`. `null` renders as an empty field, never the string `"null"`. It also guards against CSV
formula injection: a field starting with `=`, `+`, `-`, or `@` gets a leading `'` before quoting, so
a crafted name or ID like `=HYPERLINK(...)` opens as plain text in Excel/Sheets rather than
executing.

## Hours & attendance

- `GET /api/admin/reports/hours?period=<id>` and `GET /api/admin/reports/attendance?period=<id>`
  (`src/app/api/admin/reports/{hours,attendance}/route.ts`) are mentor-gated (`withRole("mentor")`)
  CSV downloads (`Content-Disposition: attachment; filename="hours-<periodId>.csv"` /
  `attendance-<periodId>.csv"`). `period` defaults to the active period when omitted; a `period`
  that doesn't exist is a `404`, not a silently empty CSV.
- `hoursReportForPeriod` (`src/lib/reports.ts`) is the hours-table equivalent of
  `periodLeaderboard`, except it includes every **active** person for the period, zero-hour members
  included — `periodLeaderboard` only lists people who appear in the period's `session` rows.
  Encoded by `hoursReportCsv` as `Name, Student ID, Hours`.
- `attendanceSummaryForPeriod` (`src/lib/attendance.ts`) fans the existing
  `attendanceSummary`/`attendanceForDate` math out per active person over the period's build days —
  it doesn't change how a day is scored, just runs it roster-wide. Returns `[]` for a nonexistent
  period. Encoded by `attendanceSummaryCsv` as `Name, Present, Excused, Absent, Required Days,
  Percent` — present/excused/absent/percentage are computed over **required** build days only
  (optional days never count toward the denominator).

## Dietary restrictions

- `GET /api/admin/reports/dietary` (`src/app/api/admin/reports/dietary/route.ts`) is mentor-gated
  (`withRole("mentor")`) and needs no `period` — it's a roster-wide snapshot, not scoped to a
  period. Response is `Content-Disposition: attachment; filename="dietary-restrictions-<YYYY-MM-DD
  UTC>.csv"`.
- `dietaryRestrictionsReport` (`src/lib/reports.ts`) lists every **active** person, any role, whose
  `dietary_restrictions` field is non-blank after trimming (whitespace-only counts as "none on
  file"), sorted by name.
- Encoded by `dietaryRestrictionsCsv` (`src/lib/reports-export.ts`) as `Name, Role, Dietary
  Restriction`.
- On `/admin/reports` the dietary table renders above the period picker (it isn't period-scoped)
  and shows "No active members have dietary restrictions on file" when empty.
