# Bionic Attendance — Source Survey

**Repo:** techplexengineer/bionic-attend — https://github.com/TechplexEngineer/bionic-attend
**Surveyed-at:** 95bb251e08f1ab8cb8aba5b17f15af1f3958784e
**Permalink form:** https://github.com/TechplexEngineer/bionic-attend/blob/95bb251e08f1ab8cb8aba5b17f15af1f3958784e/<path>
**Stack:** Go (net/http + gorilla/mux + gorilla/sessions), SQLite (modernc.org/sqlite, pure-Go driver), sqlc-generated query layer, golang-migrate for schema migrations, html/template views, Bootstrap 5 + DataTables (vendored static assets), Docker/Balena (Raspberry Pi fleet) deployment
**License:** none (all rights reserved) — no LICENSE file present in the tree; ideas only, do not copy code
**Last activity:** 2025-10-12 (pushed_at; single most recent commit 95bb251e dated 2025-10-12T23:13:13Z)
**FRC team:** Team 1519 "Mechanical Mayhem" (inferred from event list in `checkin.html` — Battle of the Bay, Granite State District, Waterbury District, New England District Championship — a New England-district team; exact number not stated in repo)
**Areas:** (1) time/attendance — the entire app; no other in-scope areas touched

## Purpose
A minimal, kiosk-style check-in tool: a Raspberry Pi with keyboard/mouse and a USB barcode scanner sits at the shop entrance, students scan a student-ID barcode, and the app records "attended this date" (not time-in/time-out) against that user for later reporting.

## Auth & Roles
None. There is no login, session-based user identity, or role model — the app is a physical-access kiosk (whoever is standing in the shop can check anyone in). `gorilla/sessions` is used only for one-shot flash messages (`SetFlash`/`GetFlash` cookie helpers referenced from `handleTemplate.go`), not authentication. An `adminOnly` middleware stub exists in `routes.go` but is commented out and unused — no admin gating is actually enforced.

## Data Model
Two SQLite tables (`db/schema.sql`):
- **users**: `userid` (barcode/ID value), `first_name`, `last_name`, `data` (free-form JSON string reserved "for future expansion", always written as `"{}"`), `hidden` (0/1 soft-delete flag). Unique constraint on `(first_name, last_name)` to prevent duplicate people.
- **attendance**: `userid`, `date` (stored as `YYYY-MM-DD` string, `time.Now().Format("2006-01-02")`). Unique constraint on `(userid, date)` — one check-in per person per day, so a re-scan same day just shows "already checked in" rather than logging a duplicate row.

One migration exists (`db/migrations/000001_add_hidden_to_users.{up,down}.sql`) adding the `hidden` column after initial release — the only schema evolution in the project's life. Queries are hand-written in `db/queries.sql` and compiled to type-safe Go via sqlc into `data/queries.sql.go` / `data/models.go` (`sqlc.yaml` config at repo root).

## Features
**Time/attendance:**
- Barcode-scanner check-in flow tuned for a scanner that appends Enter/Return: single autofocused text input, form auto-submits per scan (`checkin.html`, `checkIn.go`).
- Unknown-ID handling: scanning an ID not in `users` redirects straight into the "create user" flow pre-filled with that ID (`checkIn.go` → `/create/{userid}`), so a new student's first scan both registers and checks them in without separate admin data entry.
- Idempotent same-day check-in: a second scan the same day is detected via `IsUserCheckedIn` and shows a friendly "already checked in" flash instead of erroring or double-recording (`checkIn.go`).
- Checking in a previously soft-deleted/hidden user automatically un-hides them (`UnHideUser` call inside `handleCheckIn`, `checkIn.go`) — treats a fresh check-in as an implicit "this person is active again" signal.
- Attendance report: a pivot-style table of every non-hidden user × every meeting date, each cell marked `x` if present, plus a running total and percentage of meetings attended per person (`report.go`, `report.html`). Meeting dates are derived distinct-date groupings from the `attendance` table (`GetMeetings` query) rather than a separate events/meetings table.
- Client-side countdown widget on the check-in kiosk screen listing upcoming season events (kickoff, district events, champs) with a live JS countdown per event — hardcoded per-season in `checkin.html`, not database-backed.

**People/roster (adjacent to attendance, not a separate roster module):**
- Create user (`create.go`, `create.html`): validates userid length (>2 chars) and non-empty first/last name; checks both name-uniqueness and userid-uniqueness before insert (`CreateNewUser`).
- Edit user (`edit.go`, `edit.html`): renaming a user's `userid` cascades to both the `users` row and every existing `attendance` row for that person inside a DB transaction (`UpdateUserIDinUsers` + `UpdateUserIDinAttendance` under `tx.Begin()/Commit()/Rollback()` in `handleEditPOST`) — handles the case where a student's barcode/ID changes without losing attendance history.
- Soft-delete ("hide") a user via `SoftDeleteUser` (sets `hidden=1`) rather than a hard delete, keeping historical attendance rows intact while removing them from active check-in/roster views (`handleHidePOST`, `edit.go`). A `DeleteUser` hard-delete query exists in `queries.sql` but is unused by any handler.

## Integrations
None. No TBA/FRC-events API, no Slack/Discord/email/SMS, no OAuth/Google. The only external "integration" is deployment infrastructure: balena.io fleet management pushes the Docker image to Raspberry Pi hardware via GitHub Actions (`.github/workflows/deploy.yml`, `balena/` directory), not a data integration.

## Notable Implementation Details
- Templates and static assets (Bootstrap, DataTables, jQuery, bootstrap-icons — all vendored, no CDN) are Go-embedded into the binary via `resources-embed.go` (`//go:embed`), with a parallel `resources-fs.go` presumably for a dev-mode live-reload filesystem variant — single self-contained binary deployment, no separate static file server needed.
- DB bootstrap is embed-first: `server.go`'s `SetupDB` embeds `db/schema.sql` directly in the binary via `//go:embed`, creates the SQLite file from it on first run if missing, then runs golang-migrate migrations from an embedded `db/migrations` FS — no external migration tool or manual `psql`-equivalent step needed on the Pi.
- Attendance is presence-only by design (explicitly called out in the README): no check-out, no duration/time-of-day tracking, just "did this person show up on this date" — a much narrower model than typical time-clock software, deliberately simple for a shop-door kiosk use case.
- No pagination/scale concerns addressed anywhere — `ListUsers`, `GetAttendance`, `GetMeetings` all load full table scans into memory; fine at FRC-team roster scale (dozens of students, ~1 meeting/day) but would not survive larger scale.
- The countdown-event list in `checkin.html` is hardcoded HTML/JS per season and clearly goes stale (visible dates are from the 2023–24 season as of the surveyed commit) — a maintenance trap if reused as-is; a real re-implementation would pull this from a small events table or an external calendar rather than editing the template each season.
- `handleIndex.go` is dead/commented-out code (an earlier home-handler approach) left in the tree — not wired into `routes.go`.

## Verdict
Substantive but narrow: a clean, small, well-structured single-binary Go kiosk app that nails one thing (barcode-scan attendance for a shop door) with good touches — auto-create-on-unknown-scan, idempotent same-day check-in, transactional userid-rename-with-history-preserved, soft-delete-with-auto-revive. Worth stealing the UX ideas (scan-to-create flow, same-day idempotency, soft-delete-on-hide/auto-revive-on-checkin, embedded-binary deployment model) for a time/attendance feature; not worth stealing for roster management, integrations, or auth since it deliberately has none of those.
