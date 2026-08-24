# FRC Attend — Source Survey

**Repo:** irs1318dev/frcattend — https://github.com/irs1318dev/frcattend
**Surveyed-at:** 345f3ee362b8b1d3a684aecec9b9aee613814b93
**Permalink form:** https://github.com/irs1318dev/frcattend/blob/345f3ee362b8b1d3a684aecec9b9aee613814b93/<path>
**Stack:** Python 3.14, Textual (TUI framework), SQLite (stdlib `sqlite3`), OpenCV (`opencv-python`, QR scanning via webcam), `segno` (QR generation), `gspread` + `google-auth` (Google Sheets sync), `xlsxwriter`/`openpyxl` (Excel export), stdlib `smtplib`/`email` (Gmail sending). Packaged with `uv`/hatchling; test suite via `pytest`.
**License:** none (no LICENSE file in the tree) — all rights reserved, ideas only.
**Last activity:** 2026-08-22 (commit pushed same day as this survey; actively developed)
**FRC team:** Issaquah Robotics Society, team 1318 (IRS 1318 — see README and email template "IRS 1318 Attendance System")
**Areas:** (1) time/attendance — primary focus; (2) people/rosters — secondary (student stage/status lifecycle, Google Sheets roster sync)

## Purpose
A single-mentor-operated desktop app (not multi-user/web) that runs on a laptop connected to a webcam at meetings: students scan a personal QR code to check in, the app logs timestamped attendance against typed events (meetings, competitions, outreach, etc.), and mentors can review/export attendance, manage student roster lifecycle (prospect → member → alumni), and sync data to a Google Sheet as a shared/backup roster.

## Auth & Roles
Single shared "management password" (SHA-256 hash stored in the TOML config, default hash corresponds to `"1318"`) gates the entire app on startup (`src/frcattend/view/pw_dialog.py`, `src/frcattend/view/app.py::FrcAttend.on_mount`) — incorrect/cancelled password exits the app. No per-user accounts, no student-facing login (students only scan a QR code); this is single-role "mentor has the app open" access control, not a real auth system.

## Data Model
SQLite tables (`src/frcattend/model/*.py`, DDL embedded in each dataclass's `table_def`):
- **students** (`student_id` PK — a generated slug like `lastname-firstname-2027-042`, `first_name`, `last_name`, `email` UNIQUE, `grad_year`)
- **statuses** (`status_id` PK, `student_id` FK, `stage` enum: prospect/former_prospect/rookie/veteran/former_member/alumni, `start_date`, `reason` enum: choice/graduated/incomplete/transferred, `notes`; UNIQUE(student_id, start_date)) — full status history per student, with a `valid_prior_statuses` state-machine table enforcing legal stage transitions (`src/frcattend/model/students.py`)
- **events** (`event_date` + `event_type` composite PK, `event_type` enum: competition/kickoff/meeting/none/opportunity/outreach/virtual/volunteering, generated `day_of_week` column, `description`)
- **checkins** (`checkin_id` PK, `student_id` FK, generated `event_date`/`day_of_week` from `timestamp`, `event_type`, deferred FK to `events`, UNIQUE(student_id, event_date, event_type) — one checkin per student per event)
- **surveys** (`title` PK, `question`, `choices` JSON array, `multiselect`, `allow_freetext`, `max_length`, `replace` flag controlling whether new answers overwrite old ones)
- **answers** (composite PK student_id+survey_title+answer_date ON CONFLICT REPLACE, `choices` JSON, `freetext_answer`)

Custom `sqlite3` adapters/converters register Python enums (`Stage`, `Reason`, `EventType`) and `datetime.date`/`datetime.datetime` as native SQLite column types (`src/frcattend/model/database.py`).

## Features

### Time/attendance
- QR-code check-in scanning via webcam using OpenCV, with duplicate-scan suppression per event/day and a live scrolling log of successes/failures — `src/frcattend/view/take_attendance.py`
- Per-event optional survey prompt shown to students at checkin time (e.g., "how did you get here today") with multi-select/freetext/replace-or-append semantics — `src/frcattend/model/surveys.py`, `src/frcattend/view/take_attendance.py`, `src/frcattend/view/survey_screen.py`
- Manual add/remove of individual attendance entries (not just live scanning) — `src/frcattend/view/attendance_screen.py`
- Event CRUD: create/rename event type, move event date (blocked if checkins already exist), typed event categories — `src/frcattend/model/events_checkins.py` (`Event.update_event_type`, `update_event_date`)
- Attendance rollups: per-student checkin counts for "school year" and "build season" windows, computed from configurable season-start dates — `src/frcattend/model/attendance.py`, `src/frcattend/config.py` (`schoolyear_start_date`, `buildseason_start_date`)
- Per-event roster of who checked in — `src/frcattend/features/events.py` (`CheckinEvent`, `EventStudent`)
- Markdown dashboard summary (record counts, date ranges of first/last event & checkin, file access/modify/create timestamps) shown on the home screen — `src/frcattend/features/summary.py`
- Excel export with multiple sheets (Students, Events, Attendance by Student, Attendance by Event, Check-ins) — `src/frcattend/features/excel.py`
- Full JSON export/import of entire database — `src/frcattend/model/database.py` (`to_dict`/`load_from_dict`), wired into `src/frcattend/view/app.py`
- SQLite file backup (both ad hoc via `sqlite3` `.backup()` API and pre-download safety backups) — `src/frcattend/model/database.py::DBase.backup`

### People/rosters
- Student lifecycle state machine: prospect → (former_prospect | rookie) → veteran → (former_member | alumni), each transition requiring a specific `reason`, enforced server-side with `StatusError` on invalid transitions — `src/frcattend/model/students.py` (`Stage`, `Reason`, `valid_prior_statuses`, `Status.add_safe`)
- Documented status/stage semantics for team onboarding — `docs/student-status.md`
- Auto-generated unique student IDs from name + grad year + random suffix — `src/frcattend/model/students.py::Student.generate_unique_student_id`
- "As of date" roster queries (who was an active member on a given past date) and stage-filtered roster queries — `src/frcattend/model/students.py::Student.get_with_status`
- Student add/edit/remove screens — `src/frcattend/view/student_screen.py`, `src/frcattend/view/student_dialog.py`
- Bulk CSV import of students (per README)
- QR code generation (per-student, and bulk regeneration for entire roster) — `src/frcattend/features/qr_code_generator.py`

### Communication
- Emails each student their personal QR code as an HTML email with inline + attached image, using Gmail SMTP (SSL 465 or STARTTLS 587) — `src/frcattend/features/emailer.py::send_email`
- Bulk "email all students their codes" with a deliberate 0.5s throttle between sends after observing silent Gmail drops when sending in quick succession (documented as an empirical workaround, not a real fix) — `src/frcattend/features/emailer.py::send_all_emails`

### Third-party integrations
- Two-way sync with Google Sheets via `gspread` + a Google service-account credential (JSON pasted into the TOML config): full-database upload (one worksheet per table, auto-backup-and-clear of prior sheet contents before overwrite) and download-with-schema-validation (raises on column mismatch) — `src/frcattend/features/sync.py::Synchronizer`
- Separate `RosterUpdater` class syncs against an *external* team roster spreadsheet (different from the attendance-data sheet): matches students by (last, first, grad_year), writes back generated student IDs and attendance totals into specific mapped columns, driven by a YAML column-mapping config — `src/frcattend/features/sync.py::RosterUpdater`

## Integrations
Gmail SMTP (email), Google Sheets/Google service account (`gspread`, `google-auth`) — both for attendance-data sync and for writing back into a separate team roster sheet. No Slack/Discord/TBA/Onshape integration.

## Notable Implementation Details
- MVF ("model-view-features") layered architecture is explicitly documented as the author's own simplified spin on MVVM/MVP, chosen for teaching high-schoolers — worth noting as a clean small-scale architecture pattern (README.md, "Repository Structure" section).
- Enum-to-SQLite roundtripping done via `sqlite3.register_adapter`/`register_converter`, giving typed columns (`STAGE`, `REASON`, `EVENT_TYPE`, `DATE`, `DATETIME`, `BOOL`) without an ORM — a lightweight pattern worth reusing for typed SQLite in Python.
- Status-transition state machine (`valid_prior_statuses`) is a good small reference for enforcing lifecycle integrity purely in application code (SQLite has zero triggers/checks for it).
- `checkins` table uses `DEFERRABLE INITIALLY DEFERRED` FK to `events` to intentionally allow an in-transaction ordering flexibility — documented with a comment citing the SQLite foreign-keys doc section.
- Single shared password with a **hardcoded documented default hash for "1318"** shipped in `example-config.toml` — a real security smell if a team doesn't rotate it, worth flagging as an anti-pattern to avoid replicating (shared static password, hash committed to a template file).
- Google service-account credentials are stored as a pasted-in JSON blob inside a TOML config file (not `.env`/secrets manager) — practical for a single-laptop deployment but not a pattern to carry into a networked app.
- This is a single-machine desktop app with no real multi-user concurrency model; Google Sheets is the only "sync" mechanism across computers, and it's a manual upload/download workflow, not live sync.
- Test suite (`tests/test_*.py`) covers checkins, database, events, event-students, excel export, QR codes, roster updater, settings, students, summary, surveys, sync — reasonably thorough given app size.

## Verdict
Substantive and directly relevant: a real, actively-developed, single-purpose FRC attendance app with a clean typed-SQLite data model, a documented student lifecycle state machine, QR-code check-in via webcam, and Google Sheets roster/attendance sync. Worth stealing: the stage/reason status state machine for student lifecycle tracking, the SQLite enum adapter/converter pattern, and the season-based (school-year/build-season) attendance rollup windows. Avoid replicating the shared/static management-password auth model.
