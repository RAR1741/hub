# FRC Attendance System (RoboLancers) — Source Survey

**Repo:** isriah/frc-attendance-system — https://github.com/isriah/FRC-Attendance-System
**Surveyed-at:** a36023f01284a0ad84199e66eda99657b56cbfbf
**Permalink form:** https://github.com/isriah/FRC-Attendance-System/blob/a36023f01284a0ad84199e66eda99657b56cbfbf/<path>
**Stack:** TypeScript monorepo (npm workspaces) — Cloudflare Workers + D1 (SQLite) API, React/Vite admin dashboard, React/Vite Raspberry Pi kiosk UI, Python fingerprint bridge daemon (R503/Grow-style sensor), systemd services for Pi deployment
**License:** none (all rights reserved) — no LICENSE file present; `license` field is null on GitHub. Ideas only.
**Last activity:** 2026-08-14 (pushed_at)
**FRC team:** RoboLancers (team number not stated in repo; README says "RoboLancers Attendance", kiosk default subtitle "RoboLancers 321")
**Areas:** (1) time/attendance — primary; (2) people/rosters — roster sync/management; (4) communication — email + Discord notifications

## Purpose
A physical kiosk-based attendance system for a robotics team: students check in/out with a fingerprint scanner attached to a Raspberry Pi, the Pi syncs scan events to a Cloudflare Workers API/D1 database, and mentors manage roster, meetings, and reports through a web dashboard. It replaces manual sign-in sheets with biometric check-in plus automated absence/report notifications.

## Auth & Roles
- **Admin dashboard:** Google Sign-In (`GOOGLE_CLIENT_ID`), enforced server-side in `apps/api/src/auth.ts` (`requireAdmin`). Access is gated by an allowlist: `GOOGLE_ALLOWED_EMAILS` (comma list) or `GOOGLE_ALLOWED_DOMAIN` (email domain match). First successful sign-in from an allowlisted address auto-provisions an `admin_users` row with role `mentor`; roles are `mentor` | `admin`. Admin users can be disabled (`active` flag) which then hard-blocks login even if still allowlisted.
- **Kiosk auth:** each physical kiosk holds a bearer token; API stores only `sha256(token)` in `kiosks.token_hash` and validates via `requireKiosk` (`apps/api/src/auth.ts`), updating `last_seen_at` on every authenticated call.
- Admin user management UI: `apps/dashboard/src/App.tsx` (`AdminUsers` component, `listAdminUsers`/`upsertAdminUser` in `apps/api/src/auth.ts`) — add/deactivate mentors and promote to admin.

## Data Model
D1/SQLite schema across `apps/api/migrations/0001_initial.sql` through `0007_student_discord_user_id.sql`:
- `students` — student_id (PK), first_name, last_name, active, roster_hash (change-detection hash), roster_synced_at; later migrations add `email` (0005) and `discord_user_id` (0007), each with uniqueness enforced in application code (`requireUniqueStudentEmail`/`requireUniqueStudentDiscordUserId` in `apps/api/src/roster.ts`).
- `admin_users` — email (PK), role, active, last_login_at.
- `kiosks` — kiosk_id (PK), name, location, token_hash, active, last_seen_at.
- `fingerprint_enrollments` — student_id + kiosk_id + template_slot (unique per kiosk), finger_label, enrolled_at/deleted_at (soft delete).
- `scan_events` — raw biometric scan log: kiosk_id, local_event_id (unique per kiosk, idempotency key), student_id, occurred_at, synced_at, source, status (accepted/duplicate/rejected), rejection_reason.
- `attendance_sessions` — derived check-in/check-out pairs per student per meeting_date, rebuilt from scan_events (source_event_ids, rebuilt_at) — a materialized/derived table pattern.
- `scheduled_meetings` (0004) — meeting_date (unique), title, required flag, starts_at/ends_at, notes; supports converting unscheduled attendance into a retroactive scheduled meeting.
- `kiosk_commands` (0002) — remote-command queue (restart_display/restart_services/reboot_system) with pending/running/completed/failed lifecycle, claimed by kiosk polling.
- `kiosk_health` (0003) — kiosk heartbeat/health metrics.
- `notification_deliveries` (0006) — dedup ledger keyed by notification kind + recipient, used to prevent duplicate email/Discord sends unless `resend` is explicitly set.
- `sync_log` — audit trail of roster sync runs (status/timing/message).

## Features

### Time / Attendance (core)
- Biometric check-in/out via fingerprint sensor on a Raspberry Pi kiosk; sensor templates never leave the device, only a `member_id + template_slot` mapping syncs (`apps/kiosk/fingerprint_bridge.py`, `enroll_fingerprint.py`).
- Kiosk → API sync of scan events with idempotency (`kioskId + localEventId`), duplicate-window detection (`DUPLICATE_WINDOW_SECONDS`, default 90s) and rejection of scans from inactive/unknown members (`apps/api/src/attendanceStore.ts`, `syncKioskEvents`).
- Offline queue on the kiosk so scans still record without network and sync later (`apps/kiosk/src/service/offlineQueue.ts`, `syncClient.ts`).
- Derived attendance-session rebuild logic (pairing check-in/check-out, handling "still open" sessions) in `packages/shared/src/attendance.ts` (`deriveAttendanceSessions`), shared by API and tests.
- Manual attendance correction path: `manual_events` table + admin-entered check-in/out with reason and admin_email audit (mentioned in `0001_initial.sql`, surfaced via dashboard events tab).
- Scheduled meetings calendar with required/optional flag, start/end times, notes; bulk create/edit/delete of meetings (`apps/api/src/meetings.ts`, dashboard `Meetings` component in `apps/dashboard/src/App.tsx`).
- Retroactively promote a day's unscheduled attendance into a real scheduled meeting (`convertUnscheduledAttendanceToMeeting`, `apps/api/src/meetings.ts`).
- Reporting: per-member attendance rate/present/missed/open-session-date reports, meeting summary reports (present/absent/zero-scan meetings), meeting absence rosters, and full roster attendance summary with "open session" warnings for check-ins never closed out (`apps/api/src/reports.ts`).
- Legacy spreadsheet-style export (log-in rows, log-out rows, meeting rows, roster attendance summary, meeting summaries) for teams migrating off paper/Sheets tracking (`apps/api/src/export.ts`).
- Kiosk remote-command channel: mentors can push restart-display/restart-services/reboot commands to a specific kiosk, polled and executed by the Pi service (`apps/api/src/kioskCommands.ts`, `apps/kiosk/src/service/commandExecutor.ts`).
- Kiosk health/heartbeat reporting and a small on-device display state machine (ready/scanning/success/error/etc.) driving an LED + screen UI (`apps/kiosk/src/kioskStates.ts`, `src/service/kioskStateDecisions.ts`, `src/service/displayStateServer.ts`).

### People / Rosters
- Roster bulk sync endpoint: upserts students by external `memberId`, hashes each row to detect changes, and auto-deactivates any student no longer present in the synced set (`apps/api/src/roster.ts`, `syncRoster`/`listActiveRoster`).
- Roster CSV/manual import tab in dashboard (`RosterViewTab = "import"`, `apps/dashboard/src/App.tsx`).
- Per-member management: edit email, edit Discord user ID, activate/deactivate, hard-delete, and manage fingerprint enrollments (enroll, remap, delete) from a member detail panel (`MemberManagementTable`, `MemberDetailsPanel`, `FingerprintEnrollmentTable` in `apps/dashboard/src/App.tsx`).

### Communication
- Email notifications via a pluggable provider (`RESEND_API_KEY` or generic `EMAIL_PROVIDER_URL`/`EMAIL_PROVIDER_API_KEY`) for: meeting-absence digests to mentors, and individual member attendance-rate report emails (`apps/api/src/notifications.ts`).
- Discord webhook notifications for missing-member pings on a given meeting (mentions members lacking a Discord user ID as a separate "missing discord" list) and a Discord connectivity test button in the dashboard Overview tab (`sendDiscordMissingMemberNotifications`, `sendDiscordTest` in `apps/dashboard/src/App.tsx`).
- Duplicate-send protection: every notification kind is deduped via `notification_deliveries` unless the caller explicitly sets `resend: true`, and "preview" mode lets mentors see who would be contacted before actually sending.

## Integrations
- **Google OAuth** (admin login) — `GOOGLE_CLIENT_ID`, allowlist-based authorization.
- **Discord** — outgoing webhooks only (`DISCORD_WEBHOOK_URL`, `DISCORD_MISSING_MEMBERS_WEBHOOK_URL`); no bot/OAuth, just POSTed messages with `@mention`-style formatting.
- **Email** — Resend API or a generic HTTP email provider, configurable via env vars.
- **Cloudflare Workers + D1** as the entire backend runtime/datastore (`wrangler.toml`); no external DB.
- Custom hardware integration: R503/Grow fingerprint sensor via a Python bridge process talking newline-delimited protocol to the Node/TS kiosk service (`apps/kiosk/fingerprint_bridge.py`).

## Notable Implementation Details
- Clear separation between **raw scan events** (immutable, deduped log) and **derived attendance sessions** (rebuilt from events) — a good pattern for reconciling messy/offline hardware input without corrupting history.
- Kiosk tokens are stored only as SHA-256 hashes server-side (`auth.ts`), not plaintext — a good practice worth carrying over for any device-auth design.
- Idempotency key is `kioskId + local_event_id`, generated client-side on the Pi so offline-then-synced scans can't double count.
- Shared validation/business logic lives in `packages/shared` (a workspace package) and is imported by both the Worker API and tests — avoids duplicating date/attendance math between server and client.
- Kiosk deployment is fairly elaborate ops tooling: systemd unit files for four services (bench API, dashboard UI, kiosk service, kiosk UI), sudoers rules for reboot, autostart desktop entry, and setup scripts (`apps/kiosk/systemd/*`, `apps/kiosk/scripts/*`, `docs/PI-SETUP.md`) — useful reference for "how do you actually keep a Pi kiosk alive in a shop" but is Pi/Linux-specific, not portable code to copy.
- Test coverage is meaningfully broad — nearly every API module and several kiosk service modules have a matching `*.test.ts` file (attendanceStore, meetings, notifications, reports, roster, kioskCommands, offlineQueue, displayStateServer, etc.), a good sign of a system built to be trusted for something like attendance/eligibility data.
- CAD directory (`cad/kiosk-case`) holds a 3D-printable enclosure for the kiosk hardware — out of scope per the six-areas rule (hardware enclosure, not part-design/manufacturing *tracking*), noted but not surveyed as a feature.
- No LICENSE file despite being a public, actively-pushed repo — treat as all-rights-reserved; only architecture/approach ideas should be reused, not code.

## Verdict
Substantive and directly relevant (time/attendance core, with roster and communication features layered in) — the clearest real-world win to steal is the raw-scan-event vs. derived-session split plus the notification dedup ledger (`notification_deliveries`) pattern for avoiding duplicate absence/report emails and Discord pings.
