# Nautilus — Source Survey

**Repos (one system, two repos):**
- Frontend: https://github.com/frc-emotion/nautilus-frontend
- Backend: https://github.com/frc-emotion/nautilus-backend

(FRC Team 2658, "e-motion")

**Surveyed at commits:**
- Frontend: `f27e781636bcdd7f36893f6fc5059f1a013afac6`
- Backend: `bf10c4bb94019bc1264db2faff8c8f87ba18f6bc`

**File links:** paths below are prefixed `frontend:` or `backend:` relative to each repo root;
permalink form is
`https://github.com/frc-emotion/nautilus-frontend/blob/f27e781636bcdd7f36893f6fc5059f1a013afac6/<path>`
and
`https://github.com/frc-emotion/nautilus-backend/blob/bf10c4bb94019bc1264db2faff8c8f87ba18f6bc/<path>`.

## Purpose

Nautilus is a mobile-native (Expo/React Native) app for FRC team internal operations, built by
Team 2658. Its headline feature is **Bluetooth-beacon-based attendance**: a lead's phone
broadcasts a BLE beacon encoding a meeting ID and their own user ID; member phones passively
listen for that beacon and, on detection, POST an attendance log to the backend. This replaces
QR-code or manual sign-in schemes used by comparable tools. Beyond attendance, it covers a member
directory/roster, an admin console for account verification and role management, and a growing
in-season scouting module (match/pit scouting forms plus a data-visualization dashboard that
merges team-collected scouting stats with live The Blue Alliance data). It does not cover
purchasing or part tracking — this is a people/attendance/scouting tool, not a build-season
parts tracker. Both repos carry `[!WARNING]` banners in their READMEs stating the project is in
early-stage development with no backward-compatibility guarantee (`frontend:README.md`,
`backend:README.md`).

## Stack

- **Frontend:** React Native via Expo (`expo start --dev-client`), TypeScript, Gluestack UI
  component kit + NativeWind/Tailwind for styling (`frontend:package.json`,
  `frontend:tailwind.config.js`, `frontend:gluestack-ui.config.json`). React Navigation
  (bottom-tabs + native-stack). `axios` for HTTP, `@react-native-async-storage/async-storage` for
  local persistence, `@react-native-community/netinfo` for connectivity, `@tanstack/react-query`
  (data-viz screen only), `@sentry/react-native` for crash/error reporting, `zod` for client-side
  validation, `react-hook-form` for forms, `expo-file-system` + `expo-sharing` for CSV export,
  EAS Build for native binaries (`frontend:eas.json`). A **custom native Expo module**
  (`frontend:modules/BLEBeaconManager`) implements iBeacon-style BLE advertise/scan on both
  platforms, wired in via an Expo config plugin (`frontend:withCustomBeaconModule.js`).
- **Backend:** Python 3.13, Quart (async Flask-alike) + Hypercorn ASGI server, `quart-cors`,
  `quart-rate-limiter`, `quart-schema`, Pydantic v2 for schemas, `PyJWT` for auth tokens,
  `motor` (async MongoDB driver), `loguru` for logging, `beartype` for runtime type-checking
  (`backend:pyproject.toml`, `backend:nautilus_api/__init__.py`). Dependency management via
  Poetry.
- **Database:** MongoDB (not relational) — hand-rolled auto-incrementing integer `_id`s per
  collection instead of Mongo's default ObjectId (`backend:nautilus_api/services/account_service.py`
  `add_new_user`). Collections observed: `users`, `meetings`, `attendance`, `scouting`,
  `pitscouting`, `directory`, `updates` (news/updates feed), plus legacy `hours`/`4.5` collections
  referenced only in one-time migration code.
- **Hosting:** Railway (`backend:railway.toml`; `Config.PORT`, `Config.API_URL` branch on
  `dev`/`stage`/`prod` and resolve to `api.team2658.org` in prod, `backend:nautilus_api/config.py`).
  Frontend distributed via EAS builds (Android/iOS) with public API at `api.team2658.org` hardcoded
  as a fallback in `frontend:src/utils/Context/NetworkingContext.tsx`.
- **License:** **None found in either repo** — no `LICENSE`/`COPYING` file and no `license` field
  in `frontend:package.json` or `backend:pyproject.toml`. Treat as all rights reserved.

## Auth & Roles

- **JWT-based, no server-side session.** `POST /api/auth/login` verifies a `werkzeug`
  `generate_password_hash`/`check_password_hash` bcrypt-style hash and returns a JWT
  (`backend:nautilus_api/controllers/account_controller.py` `login_user`,
  `backend:nautilus_api/services/account_service.py` `generate_jwt_token`). Payload is
  `{user_id, role, exp}`, HS256, expiry `Config.JWT_EXPIRY_DAYS` (default 3 days)
  (`backend:nautilus_api/config.py`). The frontend stores the full user object (including token)
  in AsyncStorage under `userData` and decodes/validates the JWT client-side before optionally
  re-validating with the server (`frontend:src/utils/Context/NetworkingContext.tsx`
  `decodeJWT`/`validateToken`).
- **Role hierarchy** (`backend:nautilus_api/config.py` `ROLE_HIERARCHY`,
  `frontend:src/Constants.ts` `ROLES`): `unverified → member → leadership → executive → advisor →
  admin`. A route decorator `require_access(minimum_role=…)` or `require_access(specific_roles=[…])`
  enforces this on every protected endpoint by comparing hierarchy indices
  (`backend:nautilus_api/routes/utils.py`). New registrants start at `unverified`
  (`backend:nautilus_api/controllers/account_controller.py` `register_user`) and must be
  hand-verified by an executive/admin via a mass-verify endpoint before they can log attendance,
  see the directory, etc.
- **Registration cross-references a roster/directory.** `register_user` calls
  `cross_reference_studentID`, which looks up the submitted student ID in a separate `directory`
  collection and flags first/last-name or grade mismatches (not hard-blocked, just recorded on the
  user as `flags` for admins to review) (`backend:nautilus_api/controllers/account_controller.py`).
- **Password reset via emailed JWT deep link.** `POST /api/auth/forgot-password` emails (via
  Mailgun) a link containing a short-lived JWT; the app's custom URL scheme `nautilus://` opens the
  reset screen; a `GET /api/auth/redirect` endpoint 302s a web-opened link into the app deep link
  (`backend:nautilus_api/routes/auth_routes.py`, `backend:nautilus_api/controllers/account_controller.py`
  `send_password_email`).
- **Frontend gates navigation by role**, not just API calls: `RoleBasedTabs` filters which bottom
  tabs are shown based on `roleHierarchy[user.role]` (`frontend:src/navigation/RoleBasedTabs.tsx`),
  and `Authorization.tsx` presumably gates individual screens/actions
  (`frontend:src/navigation/utils/Authorization.tsx`).
- **Certificate/public-key pinning** is set up for the production API host — the README documents
  extracting the SSL public-key hash for pinning (`frontend:README.md`).

## Data Model

All data lives in MongoDB collections with app-assigned sequential integer `_id`s (computed as
`max(existing _id) + 1`, not Mongo ObjectIds) — see `backend:nautilus_api/services/account_service.py`
`add_new_user`.

- **User** (`users` collection) — `_id` (int), `email`, `password` (hashed), `first_name`,
  `last_name`, `student_id` (7-char), `phone`, `grade` (`9`–`12` or `N/A`), `subteam` (list of
  `software`/`electrical`/`build`/`marketing`/`design`), `role`, `api_version`, `created_at`
  (epoch), `notification_token`, `flags` (directory cross-reference mismatches),
  `fourpointfive` (bool — legacy per-student attribute migrated from an old `4.5` collection).
  Schemas: `backend:nautilus_api/schemas/auth_schema.py` (`RegisterSchema`, `UpdateUserSchema`).
- **Meeting** (`meetings` collection) — `_id`, `title`, `created_by` (user id), `time_start`/
  `time_end` (unix), `location`, `description`, `hours`, `term` (1 or 2), `year` (`"YYYY-YYYY"`,
  validated against `Config.SCHOOL_YEAR`), `dependent`/`parent` (self-reference), `members_logged`
  (array of student IDs who've checked in). Schema: `backend:nautilus_api/schemas/attendance_schema.py`
  `MeetingSchema`. **Every meeting is created as a linked pair**: a "full" meeting and an
  auto-created "(1/2)" half-duration child meeting sharing the same window
  (`backend:nautilus_api/controllers/attendance_controller.py` `create_meeting`), so a lead can
  broadcast either the full or half-credit beacon depending on how long a member actually stayed.
- **Attendance log** — embedded per-user array of `{meeting_id, lead_id, time_received, flag,
  hours, term, year}` entries (`AttendanceLogSchema`/`ManualAttendanceLogSchema` in
  `backend:nautilus_api/schemas/attendance_schema.py`); manual/admin-entered logs use sentinel
  `meeting_id = -1` (enforced by a Pydantic validator in `ManualAttendanceLogSchema`).
- **Scouting sample** (`scouting`/`pitscouting` collections) — free-form match/pit data;
  match-scouting documents carry `competition`, `teamNumber`, `matchNumber`, `won`, `auto`/`teleop`
  each with `coral: [L1,L2,L3,L4]` and `algae: [ground, net]` counts, `climb`
  (`PARK`/`SHALLOW_CAGE`/`DEEP_CAGE`), `comments`, `defensive`, `brokeDown`, `rankingPoints` — a
  2025 "Reefscape"-game-specific schema (`backend:nautilus_api/models/schemas.py`,
  `backend:nautilus_api/services/scouting_service.py`). Scoring point values per level/climb type
  are configured centrally in `Config.SCORING_CONFIG` (`backend:nautilus_api/config.py`) and
  applied uniformly when aggregating.
- **Directory** (`directory` collection) — separate pre-loaded roster (student_id, first/last
  name, grade) used only to validate self-registration, not otherwise user-editable via API
  observed.
- **Notifications/Updates** (`updates` collection) — `{update, active, created_by/edited_by/
  removed_by}` news-feed items surfaced in-app (`backend:nautilus_api/schemas/notification_schema.py`,
  `backend:nautilus_api/services/notification_service.py` — service file not read in full but
  referenced throughout `notification_controller.py`).
- **No relational integrity** — Mongo has no FKs; user deletion explicitly walks `meetings` (pulling
  the deleted user's student_id from every `members_logged` array) and the `attendance` collection
  to clean up (`backend:nautilus_api/services/account_service.py` `delete_user_meetings`,
  `delete_user_attendance`).

## Features

- **Register / Login / Forgot password** — Registration form validates password strength (8+
  chars, letter + digit), phone format, 7-char student ID, and captures subteam(s) + grade; new
  accounts start `unverified` and pending admin approval. Forgot-password emails a Nautilus
  deep-link reset URL via Mailgun. `frontend:src/screens/Auth/RegisterScreen.tsx`,
  `frontend:src/screens/Auth/LoginScreen.tsx`, `frontend:src/screens/Auth/ForgotPasswordScreen.tsx`,
  `backend:nautilus_api/routes/auth_routes.py`, `backend:nautilus_api/controllers/account_controller.py`.
- **App bootstrapping / offline-first session restore** — On launch, a stored JWT is decoded and
  checked for expiry client-side before any network call; if online, it's re-validated against
  `/api/account/validate` and the cached user refreshed; if offline, the app proceeds with the
  last-known cached user. `frontend:src/screens/Auth/AppInitializer.tsx`,
  `frontend:src/utils/Context/NetworkingContext.tsx` (`validateToken`).
- **Offline request queue with automatic replay** — Every mutating API call is wrapped in a
  `QueuedRequest`; when the device is offline the request is persisted to AsyncStorage and
  auto-replayed (with capped retries) the moment connectivity returns; 429 responses are
  rescheduled using the server's `Retry-After` header. `frontend:src/utils/Context/NetworkingContext.tsx`
  (`handleRequest`, `enqueueRequest`, `processRequestQueue`, `scheduleRetryAfter`).
- **BLE beacon broadcasting (lead side)** — A lead picks an active meeting (optionally its "half"
  child), chooses a broadcast power level (Low/Balanced/High on Android), and starts advertising an
  iBeacon whose `major`=meeting ID and `minor`=lead's user ID via the native BLEBeaconManager
  module. `frontend:src/screens/Leads/BroadcastAttendancePortal.tsx`,
  `frontend:src/utils/BLE/BLEContext.tsx`, `frontend:modules/BLEBeaconManager/`.
- **BLE beacon listening + attendance check-in (member side)** — Members start a BLE scan (with a
  selectable "Main"/"Alternative" listening mode for problematic Android devices); detected beacons
  are shown as cards with resolved lead name + meeting title; tapping one opens a confirmation
  dialog before POSTing the attendance log (queued if offline).
  `frontend:src/screens/User/LogAttendance.tsx`, `backend:nautilus_api/routes/attendance_routes.py`
  (`POST /api/attendance/log`), `backend:nautilus_api/controllers/attendance_controller.py`
  (`log_attendance`).
- **Server-side attendance guardrails** — Logging is rejected if the timestamp falls outside the
  meeting's `time_start`/`time_end` window, if the user already logged that meeting, and
  automatically **unlogs the sibling full/half meeting** so a member can't double-credit both the
  full meeting and its half-duration counterpart. `backend:nautilus_api/controllers/attendance_controller.py`
  `log_attendance`.
- **Bluetooth/location permission handling UI** — Persistent status indicators for Bluetooth and
  location state with a popup explaining what's wrong and a shortcut into system Settings.
  `frontend:src/components/PermissionStatusPopup.tsx`, `frontend:src/utils/Helpers.tsx`
  (`BluetoothStatusIndicator`, `LocationStatusIndicator`), `frontend:src/utils/BLE/permissionHelper.ts`,
  `frontend:src/utils/Context/LocationContext.tsx`.
- **Meeting management (leadership+)** — Create/update/delete meetings, each create producing a
  linked full+half pair; meeting list/detail views with and without sensitive fields (`/info`
  variants strip `members_logged`). `frontend:src/screens/Leads/MeetingsScreen.tsx`,
  `frontend:src/components/CreateMeetingButton.tsx`, `backend:nautilus_api/routes/meeting_routes.py`.
- **Attendance history (self-service)** — Members view their own logged meetings and total hours
  by term/year. `frontend:src/screens/User/AttendanceHistoryScreen.tsx`,
  `backend:nautilus_api/routes/attendance_routes.py` (`GET /api/attendance/log`,
  `GET /api/attendance/hours`).
- **Admin attendance management console** — advisor/executive/admin view of every member's
  attendance, filterable by school year/term and by a "4.5" tag, with per-user hours totals; can
  manually add an attendance log (`meeting_id = -1` sentinel) or remove manual hours; **exports the
  filtered table to CSV** via `expo-file-system` + `expo-sharing`.
  `frontend:src/screens/Admin/AttendanceManagementScreen.tsx`,
  `backend:nautilus_api/routes/attendance_routes.py` (`/manual/add`, `/modify`, `/remove`, `/all`),
  `backend:nautilus_api/controllers/attendance_controller.py`.
- **Account verification queue (executive+)** — Lists `unverified` registrants with sortable/
  searchable table, per-user flag review (directory-mismatch warnings from registration), mass
  verify (bulk role bump to `member`) and mass delete. `frontend:src/screens/Admin/VerifyScreen.tsx`,
  `backend:nautilus_api/routes/account_routes.py` (`/users/verify`, `/users/delete`),
  `backend:nautilus_api/controllers/account_controller.py` (`mass_verify_users`, `mass_delete_users`).
- **Member directory** — Searchable/filterable (by subteam, grade) roster visible to all verified
  members; a privacy-scoped `/users/directory` endpoint strips email/phone/student_id/
  notification_token/created_at/api_version before returning results, vs. the full `/users` list
  restricted to executive+. `frontend:src/screens/User/UserDirectoryScreen.tsx`,
  `backend:nautilus_api/routes/account_routes.py`, `backend:nautilus_api/services/account_service.py`
  (`get_user_directory` vs `get_all_users`).
- **Admin user edit / role change / delete** — Admin-only PUT/DELETE on any user by ID, with a
  self-delete endpoint (`DELETE /api/account/delete`) for account deletion by the user themself.
  `backend:nautilus_api/routes/account_routes.py`.
- **Profile screen** — Self-service profile view/edit and (implicitly) notification-token
  management. `frontend:src/screens/User/ProfileScreen.tsx`,
  `backend:nautilus_api/routes/notification_routes.py` (token get/set/delete).
- **Match scouting form** — Structured entry of auto/teleop coral (by level 1-4) and algae (ground/
  net) counts, climb result, win/loss/tie, defensive/broke-down flags, ranking points, free-text
  comments; submits to `pitscouting`/`scouting` collections. `frontend:src/screens/User/ScoutingForm.tsx`,
  `frontend:src/screens/User/PitScoutingForm.tsx`, `backend:nautilus_api/routes/scouting_routes.py`
  (`/form`, `/pitform`), `backend:nautilus_api/schemas/scouting_schema.py`.
- **Competition list** — Populated from a static `competitions.json` on the backend.
  `backend:nautilus_api/routes/scouting_routes.py` (`GET /api/scouting/competitions`),
  `backend:competitions.json`.
- **Scouting data-visualization dashboard** — Team-number + competition (or raw TBA event key)
  input drives two parallel views: (a) team-collected scouting aggregation — matches scouted,
  total/average points, per-level (L1-L4) point contribution chart, climb-type bar chart, computed
  server-side against a configurable point table; (b) live-pulled TBA event summary — win/loss/tie
  record, win rate, OPR/DPR/CCWM, and current ranking. `frontend:src/screens/User/DataVisualizationScreen.tsx`,
  `frontend:src/components/dataviz/*`, `frontend:src/hooks/useTeamAggregation.ts`,
  `frontend:src/hooks/useEventSummary.ts`, `backend:nautilus_api/routes/scouting_routes.py`
  (`/team_aggregation`), `backend:nautilus_api/routes/tba_routes.py` (`/event_summary`),
  `backend:nautilus_api/services/scouting_service.py`, `backend:nautilus_api/services/tba_service.py`.
- **In-app news/update feed** — Executive+ can post/edit/soft-delete short "update" announcements;
  all users fetch the active list. `backend:nautilus_api/routes/notification_routes.py`
  (`/add_noti`, `/update_noti`, `/delete_noti`, `/updates`), `frontend:src/components/UpdateRibbon.tsx`,
  `frontend:src/utils/Context/NotificationContext.tsx`.
- **Website contact-form → Discord webhook bridge** — A public (unauthenticated) endpoint relays a
  marketing-site contact form submission into a Discord channel via webhook, formatted as a rich
  embed with fields, and neutralizes `@everyone`/`@here` pings.
  `backend:nautilus_api/routes/notification_routes.py` (`/webhook`),
  `backend:nautilus_api/controllers/notification_controller.py` (`send_contact_form`).
- **App version / attendance policy endpoints** — `/version` and `/attendance-policy` serve static
  JSON so the app can show current version/build-season attendance rules; an `UpdateContext` on the
  frontend checks for out-of-date app versions and can open the store/update URL.
  `backend:nautilus_api/__init__.py`, `backend:version.json`, `backend:attendancePolicy.json`,
  `frontend:src/utils/Context/UpdateContext.tsx`.
- **Debug AsyncStorage screen** — A dev-facing tab that lets a developer inspect/clear raw
  AsyncStorage keys (offline queue, cached users/meetings) from within the running app.
  `frontend:src/screens/DebugAsyncStorageScreen.tsx`.

Not present: no push notifications (Expo push client and all trigger-notification endpoints are
explicitly commented out/marked `LEGACY` in both the frontend and backend — see
`backend:nautilus_api/config.py` and `backend:nautilus_api/controllers/notification_controller.py`),
no purchasing/ordering, no CAD/part-tracking, no vendor management.

## Integrations

- **The Blue Alliance (TBA) API** — Proxied read-only through the backend (team info, event OPRs/
  DPRs/CCWMs, rankings, matches) to build the live event-summary card; `TBA_AUTH_KEY` config,
  response caching via `Config.CACHE_TTL_SECONDS`. `backend:nautilus_api/tba_client.py`,
  `backend:nautilus_api/services/tba_service.py`, `backend:nautilus_api/utils/cache.py`.
- **Mailgun** — Transactional email for password-reset links. `backend:nautilus_api/controllers/account_controller.py`
  (`send_password_email`), config keys `MAILGUN_API_KEY`/`MAILGUN_ENDPOINT`/`MAILGUN_FROM_EMAIL`.
- **Discord webhook** — Relays public website contact-form submissions into a team Discord channel.
  `backend:nautilus_api/controllers/notification_controller.py` (`send_contact_form`), config key
  `DISCORD_WEBHOOK`.
- **Sentry** — Crash/error reporting and breadcrumb logging throughout the frontend (BLE events,
  network errors, auth errors). `frontend:src/utils/BLE/BLEContext.tsx` and nearly every screen/
  context file (`import * as Sentry from '@sentry/react-native'`).
- **Expo push notification SDK** — Wired into the backend (`exponent_server_sdk_async`,
  `AsyncPushClient`) but **entirely disabled/commented out**; the frontend does not implement push
  notifications. `backend:nautilus_api/__init__.py`, `backend:nautilus_api/controllers/notification_controller.py`.
- **Railway** — Hosting platform for the backend; `/health` endpoint exists specifically for
  Railway/monitoring checks. `backend:railway.toml`, `backend:nautilus_api/__init__.py`.

## Notable Implementation Details

- **BLE-beacon attendance is the project's defining design choice.** Rather than a QR code or
  manual roll call, a lead's phone becomes a low-power iBeacon transmitter encoding
  `(APP_UUID, major=meeting_id, minor=lead_user_id)`; members' phones passively scan for that UUID.
  This requires a custom native module (`frontend:modules/BLEBeaconManager`, per the "filename too
  long" Kotlin build-cache artifacts encountered even shallow-cloning this repo on Windows) rather
  than a pure-JS/Expo-managed BLE library, and needs both Bluetooth *and* location permissions on
  Android to function, driving a fair amount of the app's permission-handling UI.
- **Full/half meeting pairing instead of a duration field.** Rather than letting a lead award
  partial credit directly, `create_meeting` always creates two documents — the "full" meeting and
  an auto-generated "(1/2)" child at half the hours, linked via `parent`/`dependent` — and logging
  one automatically unlogs the other if already logged. This pushes partial-attendance logic into
  data modeling rather than a runtime calculation, at the cost of every meeting always existing as
  a pair (`backend:nautilus_api/controllers/attendance_controller.py` `create_meeting`,
  `log_attendance`).
- **App-assigned sequential integer IDs on top of MongoDB.** Every collection uses an
  auto-incrementing int `_id` computed via a full collection scan + `max() + 1`
  (`backend:nautilus_api/services/account_service.py` `add_new_user`) rather than Mongo's ObjectId
  or an atomic counter — a race condition under concurrent writes, and an O(n) collection read on
  every insert.
- **A live in-place API migration mechanism.** `GET /migrate` walks all users whose `api_version`
  lags `Config.API_VERSION` and runs version-specific migration functions
  (`migrate_1_0_to_1_1`) that backfill fields like `fourpointfive` from now-legacy collections;
  most of the actual migration logic is commented out as already-applied one-time work, left in
  place as a historical record (`backend:nautilus_api/services/account_service.py`).
  `migrate_user_api_version` is also invoked from a `/migrate` HTTP route with no auth guard.
- **Rate limiting keyed by JWT/IP fallback.** `RateLimiter`'s key function (`get_id`) decodes the
  Authorization JWT if present, else falls back to the caller's IP — meaning unauthenticated
  requests are limited per-IP but authenticated ones per-user regardless of IP
  (`backend:nautilus_api/__init__.py`).
- **Client-and-server-both validate JWT expiry.** The frontend decodes and checks `exp` locally
  before ever calling the network (to support offline use), then re-validates server-side when
  online — a deliberate offline-tolerant auth design, not just a corner cut
  (`frontend:src/utils/Context/NetworkingContext.tsx` `validateToken`).
- **Term/year boundaries are hardcoded, not admin-configurable.** `Config.SCHOOL_YEAR` is a static
  dict of Unix-timestamp term windows per school year baked into the backend source; adding a new
  season requires a code change and redeploy, not an admin UI action
  (`backend:nautilus_api/config.py`).
- **2025-season scoring values are explicitly marked placeholders.** `Config.SCORING_CONFIG`
  carries a `# TODO: Verify and update with official 2025 Reefscape point values` comment above
  guessed-at coral/algae/climb point values — a reminder that the scouting-aggregation numbers are
  provisional (`backend:nautilus_api/config.py`).
- **No test suite depth observed on the frontend**; the backend has a `tests/` directory
  (`backend:tests/`) not read in full during this survey but present, unlike most surveyed FRC
  tools which have none.
- **Extensive dead/commented-out code left in place** rather than deleted — before-request JWT
  auth-decorator blocks duplicated verbatim across every route file (superseded by a different
  mechanism, unclear which is authoritative), full push-notification plumbing, and old migration
  branches — suggesting an actively-iterating codebase rather than a finished/stable one.

## Activity

Backend HEAD commit dated 2026-01-18; frontend HEAD commit dated 2026-06-26 (both recent relative
to this survey date). Config still targets the 2025 "Reefscape" FRC game and carries an explicit
2025-2026 school-year term table, and the scoring config is flagged as unverified placeholder
values — consistent with a tool under active, in-season development rather than an abandoned
one-off.
