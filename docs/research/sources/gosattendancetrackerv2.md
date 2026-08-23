# Girls Of Steel Attendance Tracker V2 — Source Survey

**Repo:** girlsofsteelrobotics/GOSAttendanceTrackerV2 — https://github.com/girlsofsteelrobotics/GOSAttendanceTrackerV2
**Surveyed-at:** 3081cc7c67bb290f478ca569bb8b4f77ba5996b3
**Permalink form:** https://github.com/girlsofsteelrobotics/GOSAttendanceTrackerV2/blob/3081cc7c67bb290f478ca569bb8b4f77ba5996b3/<path>
**Stack:** Python 3 / Django 5.1, SQLite (`db.sqlite3` committed, with `dj_database_url` override for prod), server-rendered Django templates + Bootstrap, Plotly (`plotly.express`/`graph_objects`) for charts, `pandas` for report shaping, `gspread` for Google Sheets sync
**License:** none — no LICENSE file present in the tree; README carries no license notice either. Ideas only, no code reuse.
**Last activity:** 2026-03-25 (pushed_at; most recent commit surveyed)
**FRC team:** Girls of Steel (FRC 2708) — also serves their FTC teams (Hypatia, Hopper, Lovelace) and hosts SCRA (a regional FRC alliance) visitor attendance
**Areas:** (1) time/attendance — primary and only real focus; (3) third-party integrations — Google Sheets sync only, thin

## Purpose
A single Django app that runs sign-in/sign-out kiosks (RFID keyfob or name entry) for three visitor populations — GOS team students/mentors, FTC-adjacent "SCRA" visiting teams, and volunteer "Field Builders" — then reports on hours/attendance per student, subteam, program, grade, and preseason crew, with a live calendar of who's been in the shop.

## Auth & Roles
None. No user accounts, no login, no permission checks anywhere in the codebase — it's a physical kiosk app (`attendance/static/attendance/redirect_to_gos_signin_on_idle.js` auto-redirects an idle browser back to the public sign-in page after 30s, confirming the shared-kiosk model). Anyone at the terminal can sign anyone in/out by RFID or typed name.

## Data Model
Three parallel person/attendance pairs, each generated per-season (`GosStudent2025`/`2026`, `ScraVisitor2025`/`2026`, `FieldBuilder2025`/`2026`) via `attendance/models/y2025/` and `attendance/models/y2026/` packages, switched globally by `attendance/models/year.py` (`GOS_SEASON_YEAR = 2026`) and re-exported through `attendance/models/__init__.py`. This year-sharded-model pattern avoids ever migrating historical rows — old season classes stay queryable for cross-year lookups (e.g. carrying forward an RFID, see Features).

- `GosStudent<year>` — `rfid` (unique int, the keyfob ID), `first_name`, `last_name`, `inactive` (soft-delete flag), `gos_program` (FRC/FTC/Mentor), `preseason_crew`, `business_subteam`, `subteam` (technical: Design/Mechanical/Electrical/Software/DataScience/FTC crews), `grade` (IntegerChoices 7–12 + MENTOR=0). All are Django `TextChoices`/`IntegerChoices` enums defined per-year in `attendance/models/y2026/gos.py`.
- `GosAttendance<year>` — FK to student, `time_in`/`time_out` (via shared `AttendanceMixin`), `purpose`.
- `ScraVisitor<year>` — `full_name`, `team_number` (other FRC team's number); `ScraVisitorAttendance<year>` mirrors the GOS attendance shape.
- `FieldBuilder<year>` — `full_name`, `forms_completed` (CMU liability-form flag); `FieldBuilderAttendance<year>` mirrors the same shape.
- Shared behavior lives in mixins (`attendance/models/mixins.py`), not inheritance from a common table — `InOutTimeMixin` (business logic: login/logout, hour totals) and `AttendanceMixin` (abstract Django model: `time_in`/`time_out` + duration helper), composed onto each per-year person/attendance class.
- `attendance/models/date_ranges.py` defines named FRC-season windows (Fall/FTC/FRC season boundaries) per year that gate which attendance rows count toward "this season" totals.

## Features

**Sign-in / sign-out (time/attendance)**
- Debounced tap-to-toggle sign-in via RFID number OR typed "First Last" — `attendance/views/gos.py:gos_log_attendance`, shared core logic in `attendance/models/mixins.py:InOutTimeMixin.handle_signin_attempt` (1-minute debounce prevents double-taps; toggles in vs. out based on current state).
- Auto-detects RFID (all-digits input) vs. name search in one shared search box — `attendance/views/gos.py:gos_log_attendance`.
- Stale-session auto-expiry: a login open >18 hours is treated as not-logged-in rather than counted — `attendance/models/mixins.py:InOutTimeMixin.is_logged_in`, `num_hours_today_hm`, `num_hours_this_week_hm`.
- Per-person running totals: today's hours, this-week hours (Sunday–Saturday), and season-to-date hours, all rendered as "H hrs M min" strings — `attendance/models/mixins.py`.
- Idle-kiosk auto-redirect back to sign-in screen after 30s — `attendance/static/attendance/redirect_to_gos_signin_on_idle.js`.
- Third-party visitor sign-in with implicit registration (`get_or_create` on first tap) plus a one-time reminder to complete CMU liability forms — `attendance/views/scra.py:scra_log_attendance`, `attendance/views/field_builders.py:field_builders_log_attendance`.
- Live "who's currently signed in" manifest across all three populations — `attendance/views/top_level.py:ActiveManifest`.
- Site-wide calendar of daily visit counts (FullCalendar-style events, color-coded by program) — `attendance/views/utils.py:create_calendar_events_from_attendance`, consumed in `attendance/views/top_level.py:IndexView` and `attendance/templates/attendance/shared/calendar_script.html`.

**Reporting / analytics (time/attendance)**
- CSV-exportable attendance report (name, grade, total hours, distinct days checked in) — `attendance/views/gos.py:GosAttendanceReportView`.
- Per-student cumulative-hours bar chart with configurable "recommended hours/week" threshold lines (8/6/3/1 hr) computed from weeks elapsed in the season — `attendance/views/plotting_utils.py:render_cumulative_hours_plot`, `attendance/views/utils.py:get_recommended_hour_lines`.
- Per-student hours-over-time scatter/line/bar combo chart vs. the recommended-hours reference lines — `attendance/views/plotting_utils.py:render_hours_scatter`, wired at `gos/<rfid>/` detail page.
- Roll-up views (list + detail + pie chart of group sizes + box-and-whisker of hours) sliced by: subteam, business subteam, FRC/FTC program, grade year, and preseason crew — `attendance/views/gos.py` (`GosSubteamList/Detail`, `GosBusinessSubteamList/Detail`, `GosProgramList/Detail`, `GosGradeYearList/Detail`, `GosPresasonCrewList/Detail`).

**Roster / people management (people/rosters)**
- New-student intake form with duplicate-name validation and automatic RFID carry-forward from the prior season's roster by name match — `attendance/views/gos.py:GosNewStudentForm`, `new_student`.
- Bulk CSV-driven roster tagging tool (business subteam, preseason crew, FRC technical subteam vs. FTC-by-elimination) — `attendance/tools/import_metadata.py`.
- Soft-delete via `inactive` flag rather than deletion; most list views filter `inactive=False`.

## Integrations
- **Google Sheets** — every sign-in/sign-out is mirrored live to a shared Google Sheet via `gspread` service-account credentials (`credentials.json`, gitignored) — `attendance/models/sheets_backend.py:GoogleSheetsBackend`. Separate worksheet tabs per population (GoS/SCRA/Field Builder), append-row on sign-in and cell-lookup-then-update on sign-out (finds the visitor's last row by name match and writes the out-time into a fixed column index — brittle if names collide or a row is edited). Toggled globally via `attendance/models/mixins.py:CROSS_POST_LOGINS`.
- No Slack/Discord/email/SMS/TBA/Onshape integration present.

## Notable Implementation Details
- **Year-sharded models instead of a `season` FK column**: each season gets its own Django model classes/tables (`GosStudent2025`, `GosStudent2026`, …) generated by copy-pasting the previous year's module and bumping the suffix, switched by one constant (`GOS_SEASON_YEAR`). Simple and migration-free, but means cross-season joins/queries require explicitly importing the other year's model (seen in `GosNewStudentForm` reaching into `GosStudent2025` to backfill RFIDs) and the migrations history (`0003_rename_fieldbuilder_fieldbuilder2025...`, `0004_fieldbuilder2026...`) grows a full table set every year.
- Attendance-mixin abstraction (`InOutTimeMixin` for business logic on plain Python, `AttendanceMixin` for the Django-model fields) is composed identically onto three unrelated model families (GOS/SCRA/FieldBuilder) via required abstract-method overrides (`_get_attendance_set`, `_log_in`, `_full_name`) — a workable "manual interface" pattern in Django without multi-table inheritance.
- Debounce and stale-session windows are hardcoded magic numbers (1 minute, 18 hours) inline in the mixin rather than settings — would need extracting if reused.
- `db.sqlite3` is committed directly to the repo (visible in the tree listing) — a real anti-pattern for anyone recreating this (secrets/PII in git history), worth flagging as what NOT to do.
- Google Sheets signout matching is name-string based with a fixed column index per tab — fragile (duplicate names, sheet edits shift columns) and a known rough edge already patched around in `scra.py` (filtering out names containing `\` or `"` with a `# TODO filter bad names on creation, not here`).
- `DEBUG = True` and a hardcoded `SECRET_KEY` sit in committed `settings.py` — again, an anti-pattern to note, not to copy.
- Chart rendering embeds full Plotly.js via CDN per chart (`render_html_figure(... include_plotlyjs="cdn")`) rather than a single shared bundle — simple but re-downloads Plotly per page.

## Verdict
Substantive and squarely on-target for time/attendance: a real, currently-maintained (pushed within the last week of survey) FRC-adjacent kiosk attendance system with working sign-in/out, hour aggregation, season-scoped reporting, and roster segmentation. Worth stealing: the tap-to-toggle sign-in/debounce/stale-session model, the season-to-date + weekly + daily hour rollups, and the "recommended hours/week" pacing-line chart concept. Not worth stealing: committed SQLite DB, hardcoded secrets, and the year-sharded-model schema approach (a `season` FK would age better).
