# Meridian — Source Survey

**Repo:** https://github.com/Aieda1l/Meridian
**Surveyed at commit:** `284b0afb7512599365cda8bde083e7c94fd698a4`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/Aieda1l/Meridian/blob/284b0afb7512599365cda8bde083e7c94fd698a4/<path>`

## Purpose

Meridian is a full-stack attendance-tracking system built for a single FRC team's shop
operations: members check in/out via an NFC tap or a rotating QR code on an Apple/Google Wallet
pass (or in-app QR shown on their phone), a dedicated Windows kiosk app reads the tap at the shop
door, hours are tracked against configurable daily/weekly/season caps, phone geofencing can
auto-checkout a member who leaves the shop without tapping out, and admins get a dashboard for
approvals, reporting, member management, and audit review. It is a from-scratch, purpose-built
attendance app (four components: backend API, admin SPA, member PWA, kiosk scanner) — not a
general community tool.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async, `Mapped`/`mapped_column` style),
  Alembic migrations, PostgreSQL 16 with the `pgcrypto` extension, Redis (cache + rate limiting +
  replay prevention). `backend/pyproject.toml`, `backend/app/main.py`.
- **Admin Dashboard:** React 18 + Vite + TypeScript + Tailwind CSS SPA. `admin/`.
- **Member PWA:** React 18 + Vite + TypeScript + Tailwind, wrapped with Capacitor.js for an
  installable/native-ish mobile app (`pwa/android/`, `pwa/ios/` Capacitor projects present, built
  via Gradle/Xcode). `pwa/`.
- **Scanner Kiosk:** Python + PyQt6 desktop app for Windows, using `pyscard` for NFC and
  OpenCV + `pyzbar` for QR, packaged as a single executable via PyInstaller (`scanner/build.spec`).
  `scanner/`.
- **Shared:** a small `shared/` package with a configurable React auth-context factory
  (`shared/auth-client/useAuth.tsx`) and toast context reused by both admin and PWA, plus
  `shared/design-tokens.json` and `shared/neumorphism.css` for a consistent visual language across
  the three UIs.
- **License:** **none found.** No `LICENSE`/`COPYING` file at the repo root, and no `license` field
  in `backend/pyproject.toml`, `admin/package.json`, or `pwa/package.json`. Per the survey rule,
  this is **all rights reserved** — code must be recreated from scratch, not copied, if any of its
  patterns are reused.
- **Deployment/hosting:** Railway.app (`railway.toml` at repo root and inside `backend/`,
  `backend/Procfile`), with a `backend/Dockerfile` for containerized deploy. No CI configuration
  found (no `.github/workflows`).

## Auth & Roles

- **JWT-based auth**, not sessions: `backend/app/core/security.py`. Login (`POST /auth/login`)
  issues a 15-minute HS256 access token and a 7-day refresh token; refresh tokens are set as
  httpOnly cookies, with **separate cookie names for admin vs. member sessions**
  (`refresh_token_admin` vs `refresh_token`) so both can be logged in concurrently in the same
  browser (`_refresh_cookie_name`, `get_refresh_token_payload`).
- **Roles** — a `MemberRole` enum (`student`, `mentor`, `admin`) on the `Member` model
  (`backend/app/models/member.py`). Two FastAPI dependencies gate routes:
  `require_admin` (admin only) and `require_admin_or_mentor` (admin or mentor) — used across
  `admin.py`, `members.py`, `sessions.py`, `notifications.py` routers.
  `backend/app/core/security.py`.
- **Password hashing** — bcrypt via the `bcrypt` package directly (`hash_password`/`verify_password`).
- **Email lookup without exposing PII** — emails are stored only encrypted
  (`email_encrypted`), but a deterministic **HMAC-SHA256 hash of the normalized email** (keyed with
  the JWT secret as pepper) is also stored (`email_hash`, indexed) purely so login can do an O(1)
  indexed lookup without ever running a full-table decrypt-and-compare. `hash_email()` in
  `security.py`.
- **Anti-cheat device binding** — on first login, a SHA-256 device fingerprint (computed
  client-side, from browser/device signals) is bound to the member record
  (`Member.device_fingerprint`); subsequent logins from a different fingerprint are rejected. An
  admin can clear the binding via the "transfer pass" flow (`POST /members/{id}/transfer-pass`),
  intended for a lost/replaced phone. `backend/app/models/member.py`,
  `backend/app/api/routers/members.py`.
- **Scanner (kiosk) auth is separate from member auth** — scanners authenticate with a per-scanner
  API key (`X-Scanner-Key` header), bcrypt-hashed at rest (`Scanner.api_key_hashed`); a Redis cache
  keyed by SHA-256 of the raw key avoids paying the O(n)-scanners bcrypt-compare cost on every
  request, with a 1-hour TTL and self-healing on a stale cache hit (scanner since deleted).
  `get_current_scanner()` in `security.py`.
- **NFC / TOTP check-in validation, not just "did they tap a card"** —
  `backend/app/services/scan_validation.py`: NFC payloads are a custom URI
  (`frcattend://checkin?serial=...&payload=<hmac>`) whose HMAC is recomputed server-side from a
  global `NFC_HMAC_SECRET` plus the member's own (pgcrypto-encrypted) TOTP secret, so a cloned NFC
  tag without the matching secret fails; the in-app QR code instead carries a live TOTP code
  (30-second window, ±1 step tolerance for clock drift) checked via `pyotp`, with **Redis-backed
  replay prevention** (a used code is marked for 90 seconds so the same QR frame can't be scanned
  twice).
- **Bulk-imported members get auto-generated passwords** — `POST /admin/import-members` (CSV of
  member_number/name/email/phone/role) creates accounts with generated passwords and assigns the
  active season; presumably distributed out-of-band by an admin. `backend/app/api/routers/admin.py`.
- **`DEBUG_SKIP_SCAN_VALIDATION`** — a dev-only settings flag to bypass NFC/TOTP checks, with a
  model validator that **hard-fails startup if enabled while `DATABASE_URL` doesn't point at
  localhost** — a real production safety guard, not just a comment. `backend/app/core/config.py`.

## Data Model

SQLAlchemy 2.0 models under `backend/app/models/`, migrated via Alembic
(`backend/app/migrations/versions/`, 5 revisions at this commit: initial schema, geofence zones,
email hash, denied-status + notifications, device fingerprint).

- **`Member`** (`member.py`) — `member_number` (unique), PII fields stored only as
  `pgcrypto`-encrypted bytes (`name_encrypted`, `email_encrypted`, `phone_encrypted`) plus the
  `email_hash` lookup index, `role` (student/mentor/admin), `password_hashed`,
  `totp_secret_encrypted`, `pass_serial` (UUID, unique — the wallet pass identity),
  `pass_auth_token_hashed`, `device_push_token` + `device_platform` (ios/android/none),
  `is_active`, `photo_url`, `device_fingerprint`, `season_id` FK.
- **`Season`** (`season.py`) — a competition season; owns `daily_hour_cap`, `weekly_hour_cap`,
  `season_hour_cap`, and presumably start/end dates and an "active" flag (rollover creates a new
  season and closes out the old one's open sessions).
- **`Session`** (`session.py`) — one check-in/out record: `member_id`, `season_id`, `scanner_id`
  (nullable — self-report/geofence/admin actions have no physical scanner), `check_in_at`/
  `check_out_at`, `duration_minutes`, `check_in_method` (nfc/qr), `check_out_method`
  (nfc/qr/geofence/auto_timeout/self_report/admin), `selfie_url` (optional check-in photo),
  `status` (open/closed/flagged/approved/denied), `flag_reason`,
  `self_report_checkout_at`, `geofence_exit_at`. Indexed on member/season/status/check-in-time,
  plus a **partial index** on `member_id` where `status = 'open'` (fast "does this member have an
  open session" lookup — enforces the one-open-session-per-member invariant efficiently).
- **`GeofenceZone`** (`geofence_zone.py`) — named polygon (`polygon_json`, a JSON array of
  lat/lng pairs), a display `color`, many-to-many with `Scanner` via an association table
  (`scanner_geofence_zones`, `ON DELETE CASCADE` both sides) — different shop doors/scanners can
  watch different zones.
- **`Scanner`** (`scanner.py`) — a physical kiosk: `api_key_hashed`, presumably a name/location and
  its geofence-zone associations.
- **`HourWarning`** (`hour_warning.py`) — one row per (member, season, warning_type) threshold
  crossed (`daily_80pct`, `daily_cap`, `weekly_80pct`, `weekly_cap`, `season_80pct`,
  `season_cap`), `triggered_at` — used to de-duplicate repeat warnings within the same period.
- **`Notification`** (`notification.py`) — in-app message-center entries for a `recipient` (member
  or admin), read/unread state.
- **`AdminEvent`** (`admin_event.py`) — an **append-only audit log** row per admin/system action
  (actor, action type, target, timestamp/details) — login, member CRUD, pass transfer, session
  approval/denial, etc. Powers the Admin "Audit Log" page.
- **`base.py`** — shared `Base` + `TimestampMixin` (created_at/updated_at) used by every model.

All FKs use real Postgres foreign keys with cascade behavior specified explicitly (e.g. the
scanner↔zone association table), unlike the two Ruby/Python bots surveyed elsewhere in this
catalog that skip FK constraints entirely.

## Features

### Check-in / check-out
- **NFC tap check-in/out** at a kiosk scanner — `POST /scanner/checkin`, `POST /scanner/checkout`
  (`backend/app/api/routers/scanner.py`), validated via the HMAC scheme above.
- **Rotating QR check-in/out** — same endpoints, alternate payload path validated via TOTP.
- **In-app "My Pass" QR** — PWA page showing a live, client-side-generated TOTP QR code with a
  visible 30-second countdown so a member can be scanned straight off their phone screen without a
  physical pass. `pwa/src/pages/MyPass.tsx`.
- **Wallet pass install** — one-tap Apple Wallet (`.pkpass`, PKCS#7-signed) or Google Wallet
  (REST API + JWT "save to wallet" link) pass download/add from the PWA, so the NFC chip lives in
  the phone's wallet app. `backend/app/services/apple_pass.py`, `google_pass.py`,
  `backend/app/api/routers/passes.py` (`GET /passes/download/{member_id}`, wallet web-service
  routes for pass updates: `latest/{pass_type_id}/{serial_number}`, device registration,
  Apple's required `POST /passes/log` endpoint).
- **Push-triggered pass updates** — APNs (Apple) and FCM (Android/PWA) used both to push updated
  pass content and to deliver in-app alerts (hour-cap warnings, geofence events, approval
  results). `backend/app/services/push.py`.
- **Auto-timeout for forgotten checkouts** — a cron-callable endpoint (`POST
  /sessions/auto-timeout`, guarded by a `CRON_SECRET`) force-closes any session open more than 12
  hours and flags it for admin review. `backend/app/services/timeout.py`,
  `backend/app/api/routers/sessions.py`.
- **Self-reported checkout** — a member who forgot to tap out submits a claimed checkout time
  through the PWA (`PATCH /sessions/{id}/self-report`); it's flagged pending admin
  approval/denial rather than applied immediately. `sessions.py`.
- **Admin session approval/denial/force-checkout/edit** — `PATCH /sessions/{id}/approve`,
  `/deny`, `POST /admin/sessions/{id}/force-checkout`, `PATCH /admin/sessions/{id}` (edit
  check-in/out times directly), `POST /admin/checkout-all` (bulk end-of-day checkout).
  `backend/app/api/routers/admin.py`.

### Geofencing
- **Server-validated polygon zones with buffer** — the PWA's `useGeofence` hook
  (`pwa/src/hooks/useGeofence.ts`) watches device location (native Capacitor
  BackgroundGeolocation plugin, or a `navigator.geolocation`-based web fallback for browser
  testing) against the checked-in member's configured zone(s), using a point-in-polygon test plus
  a metersbuffer around the edge; requires **two consecutive "outside" readings** (one on the very
  first reading) before reporting an exit, to reduce GPS-noise false triggers.
- **Grace period before auto-checkout** — reporting an exit (`POST /geofence/exit`) starts a
  configurable grace window (default 90s, `GEOFENCE_GRACE_PERIOD_SECONDS`) server-side; the client
  polls a checkout callback at roughly a third of the grace period until the backend actually
  closes the session, and a `POST /geofence/return` cancels the pending checkout if the member
  comes back inside the zone before it fires. `backend/app/api/routers/geofence.py`.
- **Location-permission-denied reporting** — if the OS denies location access, the client posts to
  `POST /geofence/location-denied` once, so admins can see who can't be geofence-tracked (surfaced
  as an admin/member notification per the README).
- **Admin zone management** — CRUD for named polygons with a color and per-scanner associations
  (`GET/POST /admin/geofence-zones`, `PATCH/DELETE /admin/geofence-zones/{id}`), edited visually on
  the admin "Geofences" page (`admin/src/pages/Geofences.tsx`, 458 lines — a map-based
  polygon editor).

### Hours & caps
- **Daily / weekly / season hour caps**, evaluated after every checkout
  (`backend/app/services/hour_caps.py`, `hours.py`) with **80% and 100% threshold warnings**,
  each de-duplicated per period so a member isn't re-warned every checkout once already past a
  threshold (`HourWarning` rows keyed by member/season/warning-type/period). Crossing 100% flags
  future sessions in that period for review and notifies admins.
- **Member hours view** — `GET /members/{id}/hours` (daily/weekly/season totals) and
  `GET /members/{id}/sessions` (session history), surfaced on the PWA's "Status" (hour bars) and
  "History" pages.
- **Attendance leaderboard** — `GET /members/leaderboard`, ranked by total hours for the active
  season; PWA `Leaderboard.tsx`.

### Offline scanner mode
- **Encrypted local member cache** — `scanner/src/offline.py`: an AES-256-GCM encrypted cache file
  keyed by PBKDF2-HMAC-SHA256 (100k iterations) over the scanner's own API key and a random
  per-scanner salt persisted alongside the cache, so a scanner can validate/display cached member
  data without network access, and the cache is unreadable without that scanner's own key material.
- **SQLite offline event queue** — a persistent local queue (single connection reused, not
  reopened per write) of check-in/out events recorded while offline, capped at 10,000 entries with
  oldest-unsynced-dropped-first backpressure, synced back to the server on reconnect
  (`queue_event`/`get_pending_events`/`mark_synced`).

### Admin dashboard (`admin/src/pages/`)
- **Dashboard** — headline stats (`GET /admin/dashboard`). `Dashboard.tsx`.
- **Members** — list/search/filter, per-member detail/edit/deactivate, pass transfer (device
  re-bind), QR display. `Members.tsx`, `MemberDetail.tsx`, `members.py` router.
- **Bulk CSV import** — upload member_number/name/email/phone/role rows to create many members at
  once with auto-generated passwords. `POST /admin/import-members`.
- **Approvals** — queue of flagged/self-reported sessions awaiting approve/deny.
  `Approvals.tsx`.
- **Reports / export** — CSV (Excel-compatible, BOM-prefixed) and PDF (ReportLab, styled tables
  with subtotals) attendance exports with selectable columns. `Reports.tsx`,
  `backend/app/services/export.py`, `GET /admin/export`.
- **Seasons** — create a new season (rolls over: closes prior open sessions, resets cap counters),
  edit hour caps. `Seasons.tsx`, `backend/app/services/season.py`, `POST/GET/PATCH /admin/seasons`.
- **Geofences** — visual polygon zone editor (see above). `Geofences.tsx`.
- **Messages** — admin side of the in-app notification/message center. `Messages.tsx`,
  `notifications.py` router.
- **Audit Log** — read-only view over the immutable `AdminEvent` table.
  `AuditLog.tsx`, `GET /admin/audit-log`.
- **Login** — separate admin login flow using the `refresh_token_admin` cookie namespace.
  `Login.tsx`.

### Member PWA (`pwa/src/pages/`)
- **Home** — check-in/out status and quick actions. `Home.tsx`.
- **Status** — hour-cap progress bars (daily/weekly/season). `Status.tsx`.
- **History** — past sessions. `History.tsx`.
- **Leaderboard**, **My Pass** (live QR + wallet install), **Messages** (member-side notification
  center), **Login**.

### In-app notifications
- **Message center** for both students and admins — session approval/denial results, geofence
  exit/auto-checkout events, location-permission-denied alerts, hour-cap warnings — with an
  unread-count badge in the nav (`UnreadContext.tsx`), backed by `GET /notifications`,
  `GET /notifications/unread-count`, `PATCH /notifications/{id}/read`,
  `POST /notifications/mark-all-read`.

## Integrations

- **Apple Wallet** — PKCS#7-signed `.pkpass` generation (`backend/app/services/apple_pass.py`),
  Apple's pass web-service protocol (latest-pass polling, device registration, required logging
  endpoint) in `passes.py`.
- **Google Wallet** — REST API + JWT "save to wallet" link generation
  (`backend/app/services/google_pass.py`), Android device registration endpoint.
- **APNs** (Apple Push Notification service) — JWT-based auth (cached 50 min), HTTP/2 client, used
  to push pass updates and alerts to iOS. `backend/app/services/push.py`.
- **FCM** (Firebase Cloud Messaging) — Android/PWA push delivery. `push.py`.
- **PostgreSQL `pgcrypto` extension** — `pgp_sym_encrypt`/`pgp_sym_decrypt` for all PII at rest,
  called via raw SQL from `backend/app/core/encryption.py`.
- **Redis** — TOTP replay-prevention cache, scanner-auth cache, presumably rate limiting
  (`backend/app/core/rate_limit.py`).
- **Railway.app** — hosting/deploy target (`railway.toml`, `Procfile`).
- **Capacitor native plugins** — `BackgroundGeolocation` (community plugin) on the PWA for
  geofencing when installed as a native app, with an explicit web-geolocation fallback for browser
  testing.

## Notable Implementation Details

- **PII is encrypted at the column level via Postgres `pgcrypto`, not at the application layer with
  a library like `cryptography`.** Every read/write of name/email/phone/TOTP-secret round-trips
  through a `SELECT pgp_sym_encrypt(...)`/`pgp_sym_decrypt(...)` call
  (`backend/app/core/encryption.py`) using a single symmetric key from `PGP_SYM_KEY`. A
  re-implementer should note this means the DB itself never stores plaintext PII, but a single key
  compromise decrypts everything — there's no per-record or per-member key.
- **Deterministic-but-safe email lookup.** Rather than decrypt every member row to find one by
  email, a keyed HMAC hash (`email_hash`) is stored alongside the encrypted value purely for O(1)
  indexed lookup — a pattern worth reusing anywhere you need to search encrypted PII by exact
  match.
- **NFC anti-cloning relies on a *server-recomputed* HMAC, not a static per-tag secret** — the
  payload's HMAC mixes a global secret with the member's own (encrypted) TOTP seed, so copying the
  NFC payload without the ability to decrypt that TOTP secret doesn't let an attacker forge a valid
  tap for a different member or session.
- **One-open-session-per-member is enforced by a partial index**, not just application logic —
  `ix_sessions_open_member` indexes `member_id` `WHERE status='open'` — a good general pattern for
  "at most one active X per Y" lookups/guards.
- **Explicit production safety guard for a debug flag** — `DEBUG_SKIP_SCAN_VALIDATION` (skips
  NFC/TOTP checks entirely, presumably for local dev without real hardware) is force-disabled by a
  Pydantic `model_validator` if `DATABASE_URL` isn't localhost — a config-level guardrail rather
  than a code comment warning developers not to ship it enabled.
- **Offline-first kiosk design assumes real network flakiness in a shop**, not just theoretical
  offline support: encrypted local cache (so member lookups still work without connectivity),
  bounded SQLite queue with explicit drop-oldest backpressure (rather than unbounded growth or a
  hard failure), and a persistent (not per-call) SQLite connection.
- **Concurrent admin+member sessions in one browser** are supported by namespacing the refresh-token
  cookie by role (`refresh_token_admin` vs `refresh_token`) rather than assuming one logged-in
  identity per browser — relevant if a mentor tests both the admin dashboard and their own member
  PWA account side-by-side.
- **How real/complete this is:** this is not a stub or scaffold. Every layer traced (models,
  services, routers, PWA hooks, scanner offline manager) contains substantive, working logic —
  real HMAC/TOTP validation, real pgcrypto calls, a real point-in-polygon geofence algorithm with
  buffer math, real PDF generation, a real encrypted offline cache with key derivation. That said:
  **no automated test suite** was found anywhere in the repo (only Capacitor's default
  Android instrumentation-test boilerplate under `pwa/android/app/src/androidTest`/`src/test`, which
  is unrelated scaffold, not project tests), and **no CI configuration** (no `.github/workflows`).
  The shallow clone shows only a single visible commit at HEAD
  ("Added seasons tab, member session editing, hour cap editing"), whose message describes an
  incremental feature addition to an already-substantial system — consistent with active,
  iterative development rather than a one-shot dump, though full commit history wasn't available
  to confirm cadence beyond this pin.
- **No license file or manifest license field anywhere** — treat all patterns here as
  reference-only; recreate, don't copy.
