# Attendance Manager — Source Survey

**Repo:** momentumfrc/attendance-manager — https://github.com/momentumfrc/attendance-manager
**Surveyed-at:** ec16a9b697f66a4b1acfb5388cbcd252960808a7 (get via: gh api repos/momentumfrc/attendance-manager/commits --jq '.[0].sha')
**Permalink form:** https://github.com/momentumfrc/attendance-manager/blob/ec16a9b697f66a4b1acfb5388cbcd252960808a7/<path>
**Stack:** Laravel 9 (PHP) REST API backend + MySQL/MariaDB (one raw SQL VIEW), Angular (TypeScript) SPA frontend, Slack OAuth (Socialite) for auth, Spatie `laravel-permission` for roles, Docker devcontainers for dev, LiteSpeed (`lsws`) for a staging deploy target, cron-driven CLI commands for scheduled jobs.
**License:** none found (no LICENSE file in the tree, no license declared in repo metadata or composer.json) — treat as all-rights-reserved; ideas only, no code reuse.
**Last activity:** 2026-05-13 (pushed_at), most recent commit soft-deletes users (`2026_05_08_231636_soft_delete_users.php`) — actively maintained.
**FRC team:** Author "Jordan Powers" is the hard-coded initial admin (`RolesSeeder.php`); repo owner org is `momentumfrc` (Momentum, presumably an FRC team) — exact team number not stated in surveyed files; treat as "unknown/Momentum" rather than a confirmed number.
**Areas:** (1) time/attendance — primary and only real focus. (2) people/rosters — student roster is a first-class secondary concern (CRUD, bulk actions, graduation tracking). Touches (3) integrations only for auth (Slack Sign-in), not full comms.

## Purpose
A purpose-built check-in/check-out kiosk-style app for FRC team meetings: mentors (or student-leads) tap a student's name to log arrival/departure, the system derives attendance-session durations and meeting-level stats from the raw event log, and a nightly cron job auto-closes out any meeting where someone forgot to check out.

## Auth & Roles
- Auth is Slack "Sign in with Slack" (OpenID Connect) via a **custom Socialite provider** (`attendance-api/app/Providers/SlackSocialiteProvider.php`) — the OSS `socialiteproviders/slack` package predates Slack's v2 OIDC flow, so this repo hand-rolls the provider (auth URL, token exchange, `openid.connect.userInfo` call, error-checking Guzzle middleware). Registered via a service-provider event listener (`app/Listeners/SlackExtendSocialite.php`).
- Session-based login (`Auth::guard('web')->login($user, true)`) after Slack callback matches/creates a `User` by `slack_id` (`AuthController.php`). A dev-only bypass (`APP_SKIP_AUTH=true` in `.env.example`) logs in as `User::first()` for local dev.
- Roles/permissions: **Spatie `laravel-permission`**, seeded in `database/seeders/RolesSeeder.php` with three roles — `mentor` (full), `student-lead` (can view/add/check-in but not check-out others out, elevate, or delete), `read-only` (view-only stats/lists) — plus an implicit fourth state of "no role" = no app access at all. ~20 granular permissions (`list students`, `add students`, `student check in`, `student check out`, `undo attendance event`, `delete attendance event`, `elevate users`, `delete users`, `view stats`, etc.) are enforced per-controller-action via Laravel's `can:` middleware and `Gate::authorize()`.
- Bootstrap problem solved pragmatically: the seeder hard-codes an admin Slack user ID as the very first mentor, so there's always at least one account that can grant everyone else roles.
- A background/cron "system user" (`app/Console/Services/CommandService.php`) is auto-provisioned and given the `mentor` role so console commands (e.g. auto-ending a meeting) can act with proper attribution in the audit log.

## Data Model
- `students` — id, name, `graduation_year`, `registered_by`, soft-deletes (`2022_10_05...`, `2023_09_07_..._soft_delete_students.php`, `2023_10_14_..._more-student-details.php`). Unique constraint enforced app-side: no two students share (name, graduation_year).
- `attendance_events` — append-only log of `check-in`/`check-out` events per student (`student_id`, `type`, `registered_by`, soft-deletes added later in `2023_04_13_..._soft_delete_attendance_events.php`). This is the single source of truth; nothing is mutated in place, only appended and soft-deleted.
- `attendance_sessions` — **a MySQL VIEW, not a table** (`2022_11_16_000638_create_attendance_sessions_table.php`), built with a correlated subquery that pairs each check-in event with its very next check-out event per student. Derives session duration entirely from the event log at query time — no separately-maintained "session" record to keep in sync.
- `meeting_events` — separate log of team-meeting-level events (currently just `end-of-meeting`), `registered_by`, used to bound "who was still checked in when the meeting ended."
- `student_profile_images` — one-to-one with `students`, stores a `path` into local disk storage + `uploaded_by` (`2024_10_04_..._create_student_profile_images_table.php`).
- `users` — Slack-identity-linked accounts (`slack_id`, `name`, `avatar`), Spatie `roles`/`permissions` pivot tables (`2022_10_11_184027_create_permission_tables.php`), Sanctum personal-access-tokens table present but auth is actually session/cookie-based, soft-deletes added last (`2026_05_08_231636_soft_delete_users.php`).

## Features

### Time/attendance
- Check student in or out with one tap; enforced via `student check in` / `student check out` permissions (`attendance-api/app/Http/Controllers/AttendanceEventController.php`).
- **Duplicate/undo-of-duplicate suppression**: if a new event for the same student arrives within a configurable window (`config('config.simultaneous_interval')`, default 300s) of the last one, same-type events are rejected as accidental double-taps, and opposite-type events soft-delete *both* the old and new event (treated as an accidental "immediately undo" tap) — `AttendanceEventController::store()`.
- **Time-boxed self-undo**: any user can soft-delete (`undo attendance event`) their own recent check-in/out only within `config('config.undo_window')` seconds (default 30s) of creation; a `delete attendance event` permission is required to force-delete outside that window (`AttendanceEventController::destroy()`).
- Soft-deleted events can be restored (`AttendanceEventController::update()`), and can be listed `with_trashed` for audit purposes.
- **Automatic end-of-meeting**: `php artisan meetings:end` (`app/Console/Commands/EndMeeting.php`) is cron'd nightly (`deploy/scripts/daily.sh` → `deploy/deploy.env`), runs a raw SQL query to detect any student still checked in since the last `end-of-meeting` event, and if any are found, logs a new `end-of-meeting` `meeting_events` row as the system user (skippable with a fast-path when nobody's checked in, forceable with `--force`).
- Manual "end meeting" trigger from the UI is also implied by the `add meeting events` permission and `attendance-web/.../meeting-events` component.
- **Attendance-integrity auditor**: `php artisan validate:attendance` (`ValidateAttendanceEvents.php`) — an offline data-quality sweep with three heuristics: (1) repeated consecutive check-outs with no intervening check-in, (2) sessions longer than a configurable max (default 12h), (3) events within a configurable "simultaneous" window that likely represent duplicate taps or undo attempts. Supports `--detail` (tabular report) and `--fix` (interactively confirmed bulk soft-delete of flagged events).
- Session/duration computation is entirely derived (via the `attendance_sessions` VIEW) rather than stored — avoids sync bugs between "session" and "event" records.

### Reporting/stats (`ReportController.php`)
- `listMeetings` — per-meeting-date distinct-student headcounts, timezone-aware (`CONVERT_TZ`), date-ranged, limit-capped.
- `meetingAttendance` — full per-student check-in/out list for a given meeting date (defaults to most recent).
- `studentStats` — per-student aggregate: check-in count, missed-checkout count, total meeting time (seconds), computed via three correlated sub-selects joined back to `students`; date-ranged.
- Frontend renders these as `student-stats`, `meetings-report`, `meeting-attendance-report`, and a `csv-export` component (`attendance-web/src/app/components/reports/`).
- **Poll/sync endpoint** (`PollController.php`): a single `since`/`until` timestamp-windowed endpoint that returns every student, attendance event, and meeting event touched (created/updated/soft-deleted) in that window — built for a lightweight polling frontend to stay in sync without full page reloads.

### People/rosters
- Student CRUD with **duplicate-name+graduation-year prevention** enforced via composite `Rule::unique` (`StudentController.php`).
- Soft-delete/restore students individually; bulk delete/restore implied by frontend "Bulk Student Actions" feature (`README.md` feat-bulk) — graduated students can be auto-removed based on `graduation_year`.
- Profile images: upload (validated ≤1MB, jpeg/png), auto square-crop/resize to a configurable resolution via `spatie/image` + GD (`StudentProfileImageController.php`), one-per-student enforced.
- **Filesystem/DB integrity checker for photos**: `php artisan app:photo-check-fs` (`PhotoCheckFs.php`) — finds files on disk with no DB row and DB rows with no file, offers `--dry-run` / `--no-confirm` cleanup, and separately re-normalizes any stored image that's the wrong size/format (auto-migrates on the fly if `config('config.profile_image_resolution')` changes).
- User management: list users, elevate/change roles (`syncRoles`, can't self-elevate), soft-delete users (can't self-delete, can't delete a user still holding roles) — `UserController.php`.
- CSV export of attendance data (`attendance-web/.../reports/csv-export`).

### Frontend (Angular)
- Route guards for auth state and role requirements (`must-be-logged-in.guard.ts`, `must-have-role.guard.ts`, `must-not-be-logged-in.guard.ts`).
- HTTP interceptors for cookie credentials, date (de)serialization, and centralized error handling (`http-interceptors/`).
- Reusable components: confirm-dialog, date-picker, search-box, spinner, image cropper (`components/crop-image` — client-side crop before upload), paginated data source utility (`utils/PaginatedDataSource.ts`).

## Integrations
- **Slack**: Sign-in with Slack (OIDC) is the *only* integration — used purely for identity/auth, not messaging/notifications. No Slack message posting, no bot, no webhook.
- No email, SMS, calendar, TBA/FRC-API, or parts/PO integrations of any kind.

## Notable Implementation Details
- **Event-sourced attendance, not stateful sessions**: the core design decision worth stealing is storing only an append-only `attendance_events` log and deriving "sessions" (pairs, durations) via a SQL VIEW at read time. This sidesteps an entire class of bugs where a mutable "current session" record drifts out of sync with the underlying check-in/check-out taps, and it makes soft-delete/undo trivial (delete the event, the derived session view just recomputes).
- **Debounce + "opposite-type = undo" heuristic** for double-tap protection is a neat, cheap UX safeguard for a kiosk-style multi-user tap interface (no per-device session state needed) — see `AttendanceEventController::store()`.
- **Self-service undo window vs. permissioned hard delete** cleanly separates "let anyone fix their own mis-tap immediately" from "only a mentor can rewrite history later," using the *same* endpoint with an implicit-vs-explicit-force branch (`destroy()`).
- **Offline data-quality auditor** (`validate:attendance`) as a first-class, documented, dry-run-capable console command is a strong pattern for any event-log-based system — it encodes the team's own definition of "invalid data" (stale checkouts, too-long sessions, simultaneous duplicates) as re-runnable, auditable heuristics rather than ad hoc DB surgery.
- Had to hand-roll the Slack OAuth provider because Slack changed its sign-in flow to OIDC and the community Socialite package hadn't caught up — a useful signal for anyone integrating "Sign in with Slack" today.
- Deploy story is bespoke/non-containerized-in-prod: a `staging/` folder targets LiteSpeed (`lsws`) with XML vhost configs, separate from the Docker-based dev environment — not something to imitate, just noted as own-infra-specific plumbing.
- Timezone handling for reports takes an explicit `?timezone=` query param (validated as an offset, e.g. `-08:00`) rather than storing user preference, and does the conversion in raw SQL (`CONVERT_TZ`) — simple but ties reports to MySQL-specific SQL functions.
- Small rough edges: `MeetingEventController::show()` references an undefined `$meetingEvent` variable (looks like a copy-paste bug, likely a dead/untested route); the `attendance_sessions` VIEW recomputes via a correlated subquery per check-in row, which could get slow at very large event-log scale (no evidence of an issue yet given team-sized data volumes).

## Verdict
Substantive and squarely on-target for time/attendance — small in file count but deep in this one domain, with genuinely reusable *ideas*: event-sourced attendance instead of stateful check-in records, the derived-session SQL view, the debounce/undo-window permission split, and the standalone data-quality-auditor console command are all worth re-implementing (not copying) in any from-scratch attendance tracker. No LICENSE file means ideas-only.
