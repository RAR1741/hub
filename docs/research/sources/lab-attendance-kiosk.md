# lab-attendance-kiosk — Source Survey

**Repo:** HarukiWatase/lab-attendance-kiosk — https://github.com/HarukiWatase/lab-attendance-kiosk
**Surveyed-at:** da85317db745da73f1e897024a80fadef93e0638
**Permalink form:** https://github.com/HarukiWatase/lab-attendance-kiosk/blob/da85317db745da73f1e897024a80fadef93e0638/<path>
**Stack:** FastAPI (Python) backend, React + TypeScript + Vite + Tailwind kiosk frontend, Google Apps Script (TypeScript, compiled via clasp) + Google Sheets as the datastore/admin console, Raspberry Pi (nginx + systemd + Chromium kiosk) deploy target. No conventional SQL database — GAS + Sheets is the entire persistence and reporting layer.
**License:** none (all rights reserved) — no LICENSE file anywhere in the tree; ideas only, no code reuse.
**Last activity:** 2026-08-08 (pushed_at and latest commit both 2026-08-08T03:01:2*Z)
**FRC team:** not applicable — this is a **university research-lab attendance system** (Japanese, 研究室 = "laboratory/seminar room"), not an FRC team. Comparable org, labeled per instructions.
**Areas:** (1) time/attendance (primary, essentially the entire repo)

## Purpose
A QR-code check-in/check-out kiosk for a university research lab: students scan a QR badge (encoding a user ID) at a Raspberry Pi touchscreen, a FastAPI backend validates and relays the scan to a Google Apps Script web app, which appends a row to a Google Sheet and computes weekly/semester attendance analytics for lab members and a monthly summary email for the supervising professor.

## Auth & Roles
- No user login/session system for staff — the kiosk itself has no accounts. "Auth" is entirely at the machine/service level:
  - Backend↔GAS calls are authenticated with a shared secret (`GAS_SHARED_SECRET`) sent as a POST body field / GET query param and checked against `PropertiesService` in Apps Script (`gas/src/main.ts` `doGet`/`doPost`).
  - `/api/mock-scan` (backend/app/main.py) is dev-only, hard-gated by `APP_ENV != "dev"` returning 404, plus an unused `x-mock-token` header stub.
  - No end-user identity/password — a scanned `user_id` (5–12 alnum chars, regex-validated both in FastAPI and GAS) is the only "identity", checked against a `user_master` sheet for existence/active flag.
  - The professor-facing dashboard is just a protected Google Sheet tab (`10_professor_monthly`), access controlled via normal Google Sheets sharing — not an app-level role system.

## Data Model
Entirely Google Sheets-based (no SQL):
- `attendance_log` — append-only raw scan log: `timestamp, user_id, action(出勤/退勤), source, request_id, note`. Never pruned/archived by design (see lifecycle doc below).
- `session_log` — derived, rebuilt by GAS (`rebuildSessionLog()`) from `attendance_log`: pairs check-in/check-out into sessions with duration, with an `is_auto_fixed` flag for auto-corrected sessions (e.g. missing checkout) excluded from official professor metrics.
- `user_master` — `user_id, display_name, active` (roster/directory), returned to the backend and cached in-process (`USER_CACHE_TTL_SECONDS`, default 60s).
- `00_config` — semester-boundary and target config: current semester selector, semester start/end dates, official week-count `N` per semester, target weekly hours (default 15h), "as-of" date for monthly close, optional `k` (elapsed-weeks) override.
- `10_professor_monthly` / `12_monthly_history` / `11_snapshot_YYYYMM` — computed professor dashboard, historical rollups, and monthly point-in-time snapshots.
- `summary_semester` — a secondary, formula-only (ARRAYFORMULA) sheet for semester summaries; documented as *not* the source of truth for official metrics (a whole doc, `summary-semester-vs-professor-metrics.md`, exists just to disambiguate the two).
- Backend-side, in-process only (no persistence): a cooldown map (`user_id → last scan time`, dict + `Lock`) preventing duplicate scans within `COOLDOWN_SECONDS`, and a `last_action_store` used only in local-mock mode to alternate 出勤/退勤 (check-in/out).

## Features

**Time/attendance — kiosk & scan pipeline**
- QR-scan endpoint `POST /api/scan` (`backend/app/main.py`): validates `user_id` format, looks up the user (must exist and be `active`), enforces a per-user cooldown window (`COOLDOWN_SECONDS`, default 180s) returning HTTP 409 with remaining-seconds on violation, then calls the GAS webhook to append the attendance row and get back the toggled action (出勤/退勤).
- Idempotency via `client_request_id`: FastAPI normalizes/validates it (regex `^[A-Za-z0-9._-]{8,128}$`, else generates a UUID) and GAS deduplicates on `request_id` (`getActionByRequestId`), so a retried request after a network blip returns the same recorded action instead of double-logging — `gas/src/main.ts` `doPost`.
- Timeout-recovery reconciliation: if the GAS POST times out, the backend polls a `request_status` GAS endpoint by `request_id` up to `GAS_RECONCILE_ATTEMPTS` times (`GAS_RECONCILE_INTERVAL_SEC` apart) to recover the actually-committed result rather than erroring or double-writing — `call_gas_webhook()` in `backend/app/main.py`.
- Local-mock mode (`should_use_local_mock()`): when `APP_ENV=dev` and `GAS_WEBHOOK_URL` is unset/placeholder, the backend simulates users, alternates check-in/out locally, and serves canned analytics — lets the frontend/kiosk be developed with zero external Google dependency.
- React kiosk UI (`frontend/src/App.tsx`): full-screen scan view with success/blocked/error visual states, playful gamified copy ("HPがかいふくした" = "HP restored" on checkout), a 5-minute idle blackout timer for screen-burn/privacy, and a dev-only manual entry/mock-scan affordance that's compiled out of the kiosk build (`IS_DEV`/`CAN_USE_MOCK` gates).
- Server-side clock is pinned to JST (`Asia/Tokyo`) throughout the backend regardless of host TZ (`now_jst()`), so a Pi with a wrong system locale doesn't skew timestamps.

**Time/attendance — analytics & reporting**
- Per-user weekly hours + presence view: `GET /api/view/analytics/week-calendar` returns each member's current-calendar-week total hours and whether their most recent scan was a check-in (`is_present`) — tolerant parsing on both backend and GAS side for stringly-typed numbers, NaN, and camelCase/snake_case key drift from Sheets (`_week_calendar_row_from_gas_item`, `sessionLogWeekStartMatchesWeekKey_`).
- Semester-to-date analytics: `GET /api/view/analytics/semester` — weekly-average hours per member for the configured semester.
- Weekly leaderboard: `GET /api/view/ranking/weekly` — this-week vs last-week top members by total hours, computed in GAS and reshaped into a stable `RankingRow` schema.
- Semester-transition runbook (`docs/operations/semester-transition-runbook.md`): documented, deliberate policy that `attendance_log` is **never split per semester** — only a `00_config` toggle changes which date range is "current"; explicitly warns against re-interpreting boundaries via the auxiliary `summary_semester` sheet.
- Automated monthly professor report: `gas/src/sendMonthlyAttendanceReport.ts`, a time-driven GAS trigger that reads the `10_professor_monthly` sheet, computes achieved/unachieved lists against a dynamic target (parsed from a config cell like `N=15` / `15h/週`), and emails a formatted Japanese summary (with a direct link to the protected spreadsheet) to the professor + lab CC list; skips silently if the as-of date falls outside the configured semester window.
- Sheet lifecycle/protection policy documented but not automated (`docs/operations/spreadsheet-lifecycle-protection.md`): recommends periodic full-spreadsheet backups rather than deleting/archiving `attendance_log`, and flags which ranges to lock (formula rows, config auto-calculated cells) vs. which the maintenance functions must still be able to clear.

## Integrations
- **Google Apps Script + Google Sheets** as the entire backend datastore/reporting engine — the FastAPI service is a thin, validating reverse-proxy in front of a GAS web app (`GAS_WEBHOOK_URL`).
- **Gmail** (via `GmailApp.sendEmail` inside GAS) for the monthly professor report — no external email service.
- No Slack/Discord/SMS/OAuth/third-party CAD integration of any kind; this is a closed two-hop system (kiosk → FastAPI → GAS/Sheets).

## Notable Implementation Details
- Defense-in-depth against Google Sheets' loose typing is the dominant theme: both the FastAPI layer and the GAS layer independently re-parse "numbers" that might arrive as strings, comma-decimals, or NaN, and re-key camelCase vs snake_case fields defensively — worth copying the *pattern* (a single tolerant-parse helper at the trust boundary) rather than the duplicated logic.
- `doPost` in GAS wraps the whole handler in `LockService.getScriptLock()` with a 5s wait — a single global lock around the spreadsheet-append critical section, appropriate at this scale but a scaling ceiling if request volume grows.
- Idempotency-key + reconciliation-by-polling (`client_request_id` / GAS `request_status` mode) is a solid small-scale pattern for "unreliable webhook write, can't use a DB transaction" — worth reusing in any check-in flow that proxies to a non-transactional backend (Sheets, Airtable, etc.).
- Explicit design decision *not* to shard `attendance_log` by semester/year, to keep the audit trail queryable, accepting Apps Script execution-time risk long-term (documented, not yet hit).
- Kiosk-hardening details worth stealing directly: same-origin nginx reverse proxy for `/` (static) and `/api` (uvicorn) so the kiosk browser never needs CORS; a 5-minute inactivity blackout; dev-only affordances compiled out via `import.meta.env.DEV` so a production kiosk build has zero manual-entry/mock UI surface.
- Cooldown store and mock-mode "last action" store are plain in-process dicts guarded by `threading.Lock` — fine for a single-process single-kiosk deployment, but would need a shared store (Redis, etc.) for multi-kiosk fan-out.
- Extensive Japanese-language ops documentation (`docs/operations/*`, `docs/professor/*`) covers exactly the kind of "how do we run this across a semester boundary without corrupting historical data" problem a similarly long-lived FRC hour-tracking system would face.

## Verdict
Substantive and directly relevant despite the non-FRC origin: a real, deployed (Raspberry Pi kiosk) attendance system with a genuinely useful idempotency/reconciliation pattern for proxying to an unreliable downstream store, tolerant-parsing conventions worth copying, and unusually mature "what happens at semester rollover" operational documentation. Worth stealing: the `client_request_id` + status-polling reconciliation pattern, the same-origin kiosk deploy shape (nginx + systemd + Chromium), and the deliberate never-shard-the-log semester policy.
