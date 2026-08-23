# FTC Attendance Tracker — Source Survey

**Repo:** nick-koko/FTC_AttendanceTracking — https://github.com/nick-koko/FTC_AttendanceTracking
**Surveyed-at:** 3451fa49e7ddaeca9f005693f1505aafe721aeea (get via: gh api repos/nick-koko/FTC_AttendanceTracking/commits --jq '.[0].sha')
**Permalink form:** https://github.com/nick-koko/FTC_AttendanceTracking/blob/3451fa49e7ddaeca9f005693f1505aafe721aeea/<path>
**Stack:** Vite + React + TypeScript + Tailwind CSS (frontend, PWA/service worker), React Router, TanStack Query; Google Apps Script (`gas/Code.gs`) as the backend API, backed by a Google Sheet as the datastore. No conventional DB.
**License:** none (all rights reserved) — ideas only. No LICENSE file in the tree; README/docs make no license claim either.
**Last activity:** 2025-09-19 (single-commit repo; `pushed_at` and latest commit date match)
**FRC team:** unknown — comparable-org (FTC) tool, not FRC. Sample team names in config are placeholders ("Giggle Pickles", "Blockheads"), not identifiable as a real numbered team.
**Areas:** (1) time/attendance — primary and only real area covered. Roster management is present but purely as a dependency of attendance (CSV import into the same Members sheet), not a general people/roster system.

## Purpose
A lightweight PWA + Google Apps Script backend for tracking FTC team meeting attendance and off-site ("offline") work hours across three roles/views: an unauthenticated iPad kiosk for clock-in/out, a student portal for logging and reviewing offline work, and an admin portal for roster import, approvals, and reporting. Designed to run entirely on free infra (GitHub Pages + Apps Script + Google Sheets), no server or paid DB.

## Auth & Roles
- **Kiosk:** intentionally no login — anyone at the iPad can tap a tile to toggle clock in/out (`src/views/KioskView.tsx`). Abuse mitigated only at the design-doc level (throttle 1 toggle/10s, `client_ref` idempotency key), not fully visible as enforced code in the fetched `gas/Code.gs` excerpt.
- **Student:** intended to use Google Sign-In (`Session.getActiveUser().getEmail()` read server-side in `gas/Code.gs`) or one-time codes for offline-only submissions; the frontend `StudentView.tsx` doesn't itself render a Google Sign-In button — auth is expected to happen at the Apps Script layer via the browser's Google session.
- **Admin:** same Google Sign-In identity, gated by an `ADMIN_EMAILS` script property allowlist enforced server-side via `requireAdmin()` in `gas/Code.gs` (checked before offline review, clock-out-all, and member import endpoints).
- No client-side role/permission enforcement beyond which `/admin`, `/student`, `/kiosk` route the user navigates to (`src/App.tsx` — plain React Router links, no guards). All real enforcement is server-side in Apps Script.

## Data Model
Everything lives in one Google Sheet per season (documented in `attendancetrack.md`, implemented in `gas/Code.gs`):
- **Seasons** — season_id, date range, is_active.
- **Teams** — team_id, season_id, team_name, display_order.
- **Members** — member_id, team_id/season_id, first_name, last_initial, photo_url, student_email, guardian_email, is_active.
- **Sessions** (append-only event log — the core attendance table) — session_id, member_id/team_id/season_id, source (kiosk|home), type (in_person|offline), start_ts/end_ts, minutes, category (offline only), note, status (open|closed|pending_approval|approved|rejected), created_by/created_at/updated_at, client_ref (idempotency key), ua, ip_hint.
- **Meetings** (optional) — meeting_id, team_id, date, planned start/end — for computing attendance-rate-per-meeting.
- **Lookups** — offline_categories, team_codes reference tabs.
- Formula-only **Views** tabs (CurrentStatus, TotalsPerMember, TotalsPerTeam) for reporting without extra backend code.

One open in-person session per member is enforced as an invariant (toggle logic opens if none open, else closes and computes minutes).

## Features
### Time/attendance
- **Kiosk clock-in/out grid** — touch-friendly member tiles per team, green/gray state, live elapsed-time display, search-by-typing filter (`src/views/KioskView.tsx`, `src/components/MemberTile.tsx`).
- **Offline-first kiosk queue** — toggles taken while offline are queued in `localStorage` with a UUID `client_ref`, auto-flushed with exponential-ish backoff on reconnect (`src/hooks/useOfflineQueue.ts`); an `OfflineBanner` shows queued-count/offline state (`src/components/OfflineBanner.tsx`).
- **Idempotent toggle API** — `/api/session.toggle` keyed by `client_ref` so a retried/duplicated request doesn't double-toggle (`src/api.ts`, `gas/Code.gs`).
- **Live status polling** — kiosk and admin views poll `/api/status.now` on an interval (15s/30s) via TanStack Query `refetchInterval` (`src/views/KioskView.tsx`, `src/views/AdminView.tsx`).
- **Student offline-work logging** — form to submit category + minutes (or start/end) + optional note, creates a `pending_approval` session; student can view their own submission history and status (`src/views/StudentView.tsx`).
- **Admin approvals queue** — filterable by status (pending/approved/rejected/all), approve/reject/edit minutes with an audit trail via updated_by/updated_at (`src/views/AdminView.tsx`, `/api/offline.review` in `gas/Code.gs`).
- **Emergency/bulk clock-out** — admin action to close all open in-person sessions for a team in one call (`adminApi.clockoutAll`, `/api/admin.clockout_all`).
- **Planned nightly auto-clock-out trigger** — documented in `attendancetrack.md` as an Apps Script time-driven trigger to close sessions that cross midnight (design doc; not confirmed present in the fetched `gas/Code.gs` excerpt).
- **Reporting** — per-member totals by type/category/date range, per-team meeting attendance %, CSV export — specified in `attendancetrack.md`; sheet-side formula "Views" tabs back this rather than custom backend aggregation code.

### People/roster (attendance-adjacent only)
- **CSV roster import** — admin pastes/uploads CSV text, parsed client-side (`parseCsv` in `src/views/AdminView.tsx`) and POSTed to `/api/admin.import_members`, mapping to Members columns (first_name, last_initial, student_email, photo_url).
- Team switcher/season scoping throughout (all queries scoped by `season_id` + `team_id` from `src/config.ts`).

## Integrations
- **Google Sheets** as the sole datastore (via Apps Script `SpreadsheetApp`/`PropertiesService`).
- **Google Sign-In** for student/admin identity, read via `Session.getActiveUser().getEmail()` inside Apps Script — no separate OAuth flow implemented in the frontend.
- **PWA/service worker** for offline caching (`public/sw.js`, `public/manifest.webmanifest`) — not a third-party integration but worth noting as the offline-resilience mechanism.
- No Slack/Discord/email/SMS/TBA/Onshape integration present.

## Notable Implementation Details
- The whole backend is a single Apps Script file (`gas/Code.gs`) dispatching on `e.pathInfo` in one `doPost` switch, with CORS/origin allowlisting done manually against a script-property comma-list, and a uniform `{ok, data}`/`{ok, error}` response envelope — a reasonable pattern for a zero-infra backend but has no real request-size/rate limits beyond the documented (not fully verified in code) throttle intent.
- Google Sheets as the row store is a genuine scale ceiling: fine for a single team roster of a few dozen students, but the "append-only Sessions log" plus formula-based aggregation views will degrade as rows grow across seasons — the design doc's own "Season Rollover" plan (duplicate sheet, archive prior season) is effectively a manual sharding strategy to work around this.
- Idempotency via client-generated `client_ref` (nanoid on the web, `crypto.randomUUID()` in the offline queue) is a clean, cheap pattern for retryable clock toggles worth reusing regardless of backend choice.
- Kiosk deliberately has zero auth — the security model instead relies on physical access control (a locked-down iPad) plus a hidden long-press "clock everyone out" gesture and Guided Access to prevent app-switching. That's a reasonable trade for meeting-room kiosks but would need a network-perimeter equivalent (auth or IP allowlist) if adapted to a public-internet deployment.
- No tests, no CI config, no `LICENSE` — this is a personal/prototype-stage repo (single initial commit, 83KB), closer to a well-specified template (`attendancetrack.md` reads like a spec) than a battle-tested production app; several documented behaviors (nightly auto-clock-out trigger, rate limiting) are asserted in the markdown spec but not fully confirmed present in the Apps Script code sampled.

## Verdict
Substantive for its narrow scope: a clean, concrete PWA-kiosk + approval-workflow pattern for attendance/offline-hours tracking worth reusing (client_ref idempotency, offline-queue-with-flush, kiosk-no-auth + admin-allowlist split) — but it's a small single-commit prototype (no license, no tests) built on a Google-Sheets backend, so treat it purely as a design reference, not code to import.
