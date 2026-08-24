# Feature Catalog v2 — Team Hub Research (Expansion Round)

**Date:** 2026-08-22
**How to use this doc:** This is the v2 working copy of the feature catalog. Every feature and
**Decision** from [01-feature-catalog.md](01-feature-catalog.md) is carried forward **verbatim** —
those decisions stand and are not reopened here. New material from the expansion round appears in
three forms:

1. **Variant bullets** appended under already-decided features, marked **`new variant — review`**
   — the decision stays as-is; review the variant only if it changes your mind.
2. **New feature entries** in the standard format with an **empty Decision field** for you to fill
   in (`Need` / `Nice` / `Skip`, plus preferred variant).
3. A new **section 8 (Design → Manufacturing)** — a domain v1 barely touched that this round found
   a rich ecosystem for.

Full per-source reports live in [sources/](sources/). ~30 additional long-tail sources that got
one-paragraph triage (not full surveys) are indexed in [sources/99-index.md](sources/99-index.md)
and do not contribute feature entries here.

**Sources & shorthand:**

| Shorthand | Source | Stack | License |
|---|---|---|---|
| **GP** | [GatherPack](https://github.com/GatherPack/gatherpack) @ `6f3047d` | Rails 8 / PostgreSQL / Hotwire | MIT |
| **AT** | [AdvantageTrack](https://github.com/Mechanical-Advantage/AdvantageTrack) @ `218e6a1` | Python CherryPy / Google Sheets | MIT |
| **RAR** | [RAR1741/tracking](https://github.com/RAR1741/tracking) @ `89bc811` | React Router 7 SSR / Express / Drizzle / PostgreSQL | none (private) |
| **CH** | [cheesy-hours](https://github.com/Team254/cheesy-hours) @ `518df05` | Ruby Sinatra / MySQL | none (all rights reserved) |
| **CM** | [cheesy-mail](https://github.com/Team254/cheesy-mail) @ `bbc62a0` | Go SMTP daemon / SES | none (all rights reserved) |
| **CP** | [cheesy-parts](https://github.com/Team254/cheesy-parts) @ `034ef59` | Ruby Sinatra / MySQL | BSD 2-Clause |
| **Den** | [heatonk/TigerDen](https://github.com/heatonk/TigerDen) @ `45045ad` (FRC 5010; the app formerly surveyed outside-in as den.tigerdynasty.app — **source found & confirmed this round**) | React 19 / Vite 6 SPA + Express 4 / SQLite (better-sqlite3) | none (all rights reserved) |
| **NT** | [nautilus-frontend](https://github.com/frc-emotion/nautilus-frontend) @ `f27e781` + [nautilus-backend](https://github.com/frc-emotion/nautilus-backend) @ `bf10c4b` (FRC 2658) | Expo/React Native + Python Quart / MongoDB | none |
| **MD** | [Meridian](https://github.com/Aieda1l/Meridian) @ `284b0af` | FastAPI / PostgreSQL (pgcrypto) / Redis + React admin + Capacitor PWA + PyQt6 kiosk | none |
| **PB** | [8793PartBot](https://github.com/pureh2oo/8793PartBot) @ `8f2390b` (FRC 8793) | Node discord.js bot + Google Apps Script / Google Sheets | ambiguous (README claims custom MIT; **no LICENSE file** — treat as none) |
| **OT** | [OptixToolkit](https://github.com/Team-Optix-3749/OptixToolkit) @ `1ecbc75` (FRC 3749) | Flutter client + Firebase Auth (backend not in repo; MongoDB inferred) | MIT |
| **RR** | [RoboRegistry](https://github.com/bubner/RoboRegistry) @ `943e1ee` | Flask / Firebase Realtime DB / Vercel | **GPL-3.0** (copyleft — ideas only) |
| **V8** | [vector-8177-attendance-system](https://github.com/Speedstrike/vector-8177-attendance-system) @ `4acbf9a` (FRC 8177) | Flutter (Windows desktop) / Firestore | ambiguous (MIT headers; **no LICENSE file** — treat as none) |
| **SD** | [Swartdogs/AttendanceTracker](https://github.com/Swartdogs/AttendanceTracker) @ `8ec21fc` (FRC 525) | C# WinForms / local JSON+CSV files | **GPL-3.0** (copyleft — ideas only) |
| **YB** | [yeti-robotics/basecamp](https://github.com/yeti-robotics/basecamp) @ `78ad464` (FRC 3506) | Turborepo: Next.js 16 dashboard + NestJS API + Postgres (all scaffold) | none ("All rights reserved") |
| **YP** | [yeti-robotics/procurementbot](https://github.com/yeti-robotics/procurementbot) @ `561ea01` (FRC 3506) | README only — zero code | none |
| **HS** | [hawk-shop](https://github.com/FRC2713/hawk-shop) @ `59fc217` (FRC 2713) | TanStack Start / React 19 / Drizzle / SQLite, Onshape OAuth | none |
| **KS** | [kanshape](https://github.com/wave-2826/kanshape) @ `4734932` (FRC 2826) | SvelteKit (Svelte 5) + PocketBase (Go + JS hooks) | MIT (stale template attribution; terms valid) |
| **FO** | [frctools/order-list](https://github.com/frctools/order-list) @ `68045a4` (orders.frctools.com) | Nuxt 4 / Drizzle / PostgreSQL / Cloudflare Workers, better-auth orgs, MeiliSearch | MIT (© Graham Howard) |
| **FB** | [FRC BOM](https://frcbom.com/) (closed-source SaaS, FRC 4414 author) — outside-in survey | unknown (web app + Onshape OAuth/webhooks) | closed source — no repo |
| **OMP** | [OnshapeManufacturingPipeline](https://github.com/Mechanical-Advantage/OnshapeManufacturingPipeline) @ `2559413` (FRC 6328) | Vanilla JS single-file pages + Vercel functions / Neon Postgres / Vercel Blob | none |
| **PC** | [PenguinCAM](https://github.com/6238/PenguinCAM) @ `13af7a9` (FRC 6238) | Python Flask + vanilla JS, ezdxf/shapely G-code engine | MIT |
| **PT** | [frc-part-tracker](https://github.com/rogowskicr/frc-part-tracker) @ `e1f9121` | **Next.js 16 / React 19 / Supabase (Postgres + RLS) — same stack as hub** | none |
| **FM** | [FRC_Manager](https://github.com/tkruger/FRC_Manager) @ `8ec18ab` | Next.js 16 / Prisma 7 / PostgreSQL / NextAuth v5 | **Apache-2.0** |
| **DZ** | [FRCDiscord/Dozer](https://github.com/FRCDiscord/Dozer) @ `704a6fa` | Python discord.py / PostgreSQL (asyncpg) | **GPL-3.0** (copyleft — ideas only) |

File references are `SOURCE: path` relative to each repo's root, pinned at the commit above (see
each source doc for permalink form). FB has no code references — entries cite its docs/site and
Chief Delphi threads, documented in [sources/frcbom.md](sources/frcbom.md).

The shorthand table above covers the 25 v1/round-2 sources. **Round-3 sources are cited inline by
survey link** (`sources/<name>.md`) rather than shorthand — see the license note above and the
complete pinned index in [03-exhaustive-index.md](03-exhaustive-index.md).

> **License ground rule (unchanged from v1, extended):** We **recreate features, not code.** Only
> GP, AT (MIT), CP (BSD-2), OT, KS, PC, FO (MIT), and FM (Apache-2.0) carry open-source grants.
> New this round: three sources are **GPL-3.0** (RR, SD, DZ) — copyleft means copying code would
> obligate us to GPL our repo, so those are strictly ideas-only. Two sources have **ambiguous**
> licensing (PB: README claims a custom MIT variant but ships no LICENSE file; V8: MIT file
> headers, no LICENSE file) — treat both as unlicensed until clarified. Den, NT, MD, HS, OMP, PT,
> YB, YP have **no license** — all rights reserved, ideas only. FB is closed-source SaaS —
> observed behavior only. KS's LICENSE has a stale copied-from-template attribution but the MIT
> terms themselves are valid.
>
> **Round 3 (this update):** the ~90 additional repos found in the exhaustive sweep are **not**
> given shorthand codes — they are cited inline by name + survey link (e.g.
> [GoS Admin Portal](sources/gos_admin_portal.md)), each with its license flagged at the point of
> mention. The same ground rule applies per-mention: **no license / GPL / AGPL / ambiguous =
> ideas-only**; MIT/BSD/Apache = code may be reused with attribution. One repo
> (**bc3tech/frc-discord-bot**) carries an explicit anti-LLM clause and was **fully excluded** — no
> code analyzed, kept only as an exclusion record. The full pinned + licensed index of every
> round-3 source is [03-exhaustive-index.md](03-exhaustive-index.md).

---

## 1. Attendance / Hours Tracking

### 1.1 Kiosk sign-in (tap or type)
Members sign in at a shared device at the shop door.
- **AT** — tap your name from an alphabetized grid on a touchscreen (`www/static/modules/popupMenu.mjs`, `web_server.py`). No auth; identity = tapping a name.
- **CH** — type/scan a student ID into an autofocused field, barcode-scanner friendly (`hours_server.rb` `post /signin`, `views/index.erb`). IP-whitelisted so only the lab kiosk can sign in.
- **GP** — scan an RFID token at a full-screen kiosk; shows your per-period hours, punch in/out buttons (`app/controllers/time_kiosk_controller.rb`, `app/views/layouts/kiosk.html.erb`). Kiosk sits behind a logged-in session.
- Variants differ on **identity mechanism**: name-tap (zero hardware, spoofable) vs student-ID/barcode (cheap scanner) vs RFID card (needs cards + reader).
- **Decision:** Need · Preferred variant: Let's start with no auth, name-tap kiosk (AT) for v1, and add student-ID/barcode (CH) or RFID (GP) later if needed.
- **MD** *(new variant — review)* — the most hardened kiosk surveyed: NFC tap from an Apple/Google **Wallet pass** or a rotating in-app **TOTP QR code** (30s window, Redis replay prevention), read by a dedicated PyQt6 Windows kiosk with per-scanner API keys and an encrypted offline member cache + queued events for flaky shop Wi-Fi (`backend/app/services/scan_validation.py`, `scanner/src/offline.py`). Heavy, but the wallet-pass idea is genuinely novel.
- **NT** *(new variant — review)* — no kiosk at all: a lead's phone broadcasts a **BLE iBeacon** encoding meeting ID + lead ID; members' phones passively detect it and confirm check-in (`frontend:modules/BLEBeaconManager`, `backend:.../attendance_controller.py`). Zero shared hardware, but requires a native mobile app + Bluetooth/location permissions.
- **V8** *(new variant — review)* — minimal name-tap Flutter desktop kiosk, four tiles per row, in-memory check-in state (lost on restart), duration written to Firestore on check-out (`lib/screens/home_screen.dart`). Confirms AT-style name-tap is the low floor.
- **SD** *(new variant — review)* — type-your-ID WinForms kiosk with a shared 4-digit **mentor unlock code** gating admin actions and a 2-minute auto-relock; new IDs require mentor code re-entry so students can't mint roster entries (`AttendanceForm.cs`, `NewStudentForm.cs`). The mentor-PIN-unlock idea is portable even though the app is a 2022-era local-file tool.
- **[GoS Admin Portal](sources/gos_admin_portal.md)** *(new variant — review)* — the most hardened cloud-kiosk unlock surveyed: a mentor enters an **emailed 6-digit OTP** (10-min TTL) that sets an HttpOnly per-kiosk session cookie, so the browser never holds an API key (a separate `KioskDevice.api_key` exists only for genuine server-to-server callers) (`attendance/kiosk_utils.py`, `api/kiosk_views.py`). Django/Postgres, no license.
- **[JaguarRobotics/management-system](sources/management-system.md)** *(new variant — review)* — PIN sign-in returns the student's server-computed **lateness/absence counters in the same lookup**, and resolves "the current meeting" via a ±1h window around the scheduled start/end rather than an exact match (`KioskApis.java`). Java/Spark, no license.
- **[bionic-attend](sources/bionic-attend.md)** *(new variant — review)* — scanning an **unrecognized barcode routes straight into a pre-filled create-user flow**, so a new student's first scan both registers and checks them in with no admin step; a same-day re-scan is idempotently caught (`checkIn.go`). Go/SQLite, no license.
- **[FRC-Attendance-System (RoboLancers)](sources/frc-attendance-system.md)** *(new variant — review)* — **biometric fingerprint** check-in via an R503 sensor on a Pi kiosk: templates never leave the device, only a `student_id + template_slot` mapping syncs, and each kiosk authenticates with a bearer token the server stores only as a SHA-256 hash (`apps/kiosk/fingerprint_bridge.py`, `apps/api/src/auth.ts`). TS/Cloudflare Workers, no license.
- *Also seen in round 3:* [deceptivehours](sources/deceptivehours.md) (typed/QR Member ID, mentor-unlocked), [FRC 1164](sources/frc-attendence-system.md) (tap-grid + tap-again-to-uncheck toggle), [PunchCard](sources/punchcard.md) (barcode-poll auto-create + confirm-or-overwrite on dup), [kcq888](sources/kcq888-attendance.md) (deterministic `<rfid>_<date>` doc-id dedup; companion Pi+RFID→Firestore bridge), [FTC_AttendanceTracking](sources/ftc_attendancetracking.md) (auth-free tile tap, Google-Sign-In admin), [thanewye/cheesy-hours](sources/thanewye-cheesy-hours.md) (full-ID → last-4 fallback lookup, collision-risky).

### 1.2 Sign-out flows & forgotten-sign-out cleanup
- **AT** — self sign-out by tapping your name in "Who's Here"; auto-timeout closes forgotten manual sessions after N hours with a backdated end time (`monitor.py`).
- **CH** — students *cannot* sign themselves out; a mentor signs them out via web UI or SMS. A scheduled sweep (`get /signout_automatic`) closes stragglers as "Automatic - Didn't Sign Out", backdated by a config offset.
- **GP** — self punch-out at kiosk (clamped to period end); managers can punch out a whole period at once; a "flagged punches" screen lists over-long, still-open, and overlapping punches for bulk cleanup (`app/controllers/time_clock_punches_controller.rb` `flagged`).
- **Den** — self clock-out from your own device (single open session enforced); at midnight on a meeting day, open sessions auto-close **backdated to the meeting's end time** — arguably the cleanest forgotten-sign-out policy surveyed.
- Design questions: who may sign a member out, and how are forgotten sessions healed (auto-sweep with backdating vs manual review queue vs both).
- **Decision:** Need · Preferred variant: GP to start, with Den's auto-close at meeting end time as a nice-to-have.
- **Den** *(new variant — review)* — source now confirms the mechanism: `sweepForgottenClockOuts()` runs at startup + every 10 minutes, closes any session open from a prior day backdated to `latestMeetingEndOnDay` from the Google Calendar feed, stamped `updatedBy: 'auto (midnight)'` (`Den: server.ts:2305-2337`, `server/calendar.ts`). Single-open-session invariant enforced app-side.
- **MD** *(new variant — review)* — layered cleanup: a cron-triggered auto-timeout force-closes sessions open >12h and **flags them for admin review** rather than silently healing; members can also submit a **self-reported checkout time** that lands in an approval queue; geofence exit (see 1.3) is a third path (`backend/app/services/timeout.py`, `sessions.py`). One-open-session is enforced by a Postgres **partial index** (`WHERE status='open'`) — a pattern directly reusable on Supabase.
- **SD** *(anti-pattern, new variant — review)* — bulk force-checkout backdates every open session to check-in **+10 minutes flat** regardless of actual presence (`Student.cs CheckOut(forced:true)`) — a cautionary example of a synthetic-duration heal that corrupts hours data.
- **[Second](sources/second.md)** *(new variant — review)* — **per-weekday auto-checkout rules** with a separate check-time and apply-time per day, plus an explicit "backdate to previous calendar day" flag for overnight checks, evaluated once a minute by a dedicated scheduler — finer-grained than Den's single meeting-end backdate (`lib/config_table.dart`). Flutter, GPL-3.0 (ideas only).
- *Also seen in round 3:* [attendance-manager](sources/attendance-manager.md) (nightly cron auto-closes still-checked-in students at meeting end), [PunchCard](sources/punchcard.md) ("Sign Out All Users" bulk end-of-day sweep), [GoS Admin Portal](sources/gos_admin_portal.md) (auto-closes stale prior-day sessions before a new tap is evaluated).

### 1.3 Automatic presence detection (Wi-Fi)
- **AT only** — background thread flood-pings the shop IP range, resolves MACs via `arp`, matches registered devices, auto-opens/closes visits (`monitor.py`, `arp.py`). Includes device registration pairing flow with QR code (`web_server.py` `/add`), randomized-MAC detection with per-OS fix instructions, grace periods, and backdated auto-sign-out. Requires an always-on box on the shop LAN — fundamentally incompatible with pure cloud hosting (a small on-site agent posting to a cloud API could replicate it).
- **Decision:** Nice (later) — we can start with manual sign-in/out and add Wi-Fi presence detection later if desired
- **NT** *(new variant — review)* — BLE beacon proximity (see 1.1) is effectively presence detection scoped to a meeting: the server also rejects check-ins outside the meeting's time window and prevents double-crediting a meeting and its half-credit sibling (`backend:.../attendance_controller.py log_attendance`).
- **MD** *(new variant — review)* — phone **geofencing** auto-checkout: the member PWA watches device location against admin-drawn polygon zones (point-in-polygon + buffer, two consecutive outside readings to defeat GPS noise), reports an exit, and the server closes the session after a 90s grace window unless the member returns (`pwa/src/hooks/useGeofence.ts`, `backend/app/api/routers/geofence.py`). Cloud-compatible (no LAN box), but needs an installed mobile app with location permission.
- **[frc-attendance](sources/frc-attendance.md)** *(new variant — review)* — passive attendance via **live webcam face recognition** against a small pre-encoded roster, logged once per person per run above a confidence threshold — a distinct auto-detect mechanism from Wi-Fi/BLE/geofence, though this implementation is a hardcoded-roster, no-persistence prototype not worth emulating structurally (`frcAttendanceWithConfidence.py`). Python/OpenCV, no license.
- *Also seen in round 3:* [FRC_Attendance-App](sources/frc_attendance-app.md) (same face-recognition mechanism, daily+lecture dedup, separate physical IN/OUT-station launch mode), [myWB-web](sources/mywb-web.md) *(anti-pattern)* (geofenced GPS check-in via **client-side** Haversine with no server verification — a weaker cousin of MD's server-verified geofencing).

### 1.4 Live "who's here" board
- **AT** — real-time via WebSocket push, distinguishes manual vs auto-detected attendees (`www/static/modules/hereNow.mjs`).
- **CH** — 120-second jQuery poll; anonymous viewers see only IDs, logged-in viewers see names (`get /lab_sessions/open`, `views/signed_in_list.erb`).
- **Den** — "In the shop" live list of currently clocked-in members.
- **Decision:** Need · Preferred variant: Den, with WebSocket push if we can get it working on Vercel/Supabase; otherwise a 30–60s poll is fine.

### 1.5 Hours totals & leaderboard
- **CH** — leaderboard of all students by total project hours with session counts (`get /leader_board`); per-student detail page listing every session.
- **GP** — hours shown per time-clock period on person profiles and at the kiosk; period summary report with daily breakdown, distinct-people counts, calendar rendering (`time_clock_periods_controller.rb` `summary`).
- **Den** — totals per subteam plus a team leaderboard; only mentor-confirmed hours count.
- **AT** — no in-app totals; analysis lives in Google Sheets formulas.
- **Decision:** Need · Preferred variant: GP, as well as a per-student detail page like CH.
- **MD** *(new variant — review)* — leaderboard ranked by season hours (`GET /members/leaderboard`) plus per-member daily/weekly/season hour bars in the member PWA (`pwa/src/pages/Status.tsx`).
- **NT** *(new variant — review)* — self-service attendance history with totals **by term/year** (school-year terms, not seasons), plus an admin console filterable by year/term with per-user totals (`frontend:.../AttendanceHistoryScreen.tsx`, `AttendanceManagementScreen.tsx`).
- **[FRC-TimeTracker](sources/frc-timetracker.md)** *(new variant — review)* — a **points/gamification layer atop raw hours**: admins define point values per event/action type and apply them to a student independent of hours logged, surfaced alongside the hours leaderboard (`src/app/model/points.ts`). Angular, ambiguous license.
- **[GOSAttendanceTrackerV2](sources/gosattendancetrackerv2.md)** *(new variant — review)* — per-student cumulative-hours chart with a dynamically-computed **"recommended hours/week" pacing reference line** (8/6/3/1h tiers by weeks elapsed in the season), distinct from a flat leaderboard (`attendance/views/plotting_utils.py`). Django, no license.
- *Also seen in round 3:* [team8/attendance-web](sources/attendance-web.md) (per-user hours-over-time Chart.js line + sortable roster/hours table; no auth/season).

### 1.6 Attendance calendar & required/optional days
- **CH only (rich)** — build-day calendar grid: students × build days, color-coded present/absent/excused/optional, attendance rate per student, excused-absence workflow, scheduled build days with required/optional precedence rules, semester windows (`views/calendar.erb`, `queries.rb`, `models/scheduled_build_day.rb`, `models/excused_session.rb`). "My Attendance" self-service page per student.
- **Den (different angle)** — meeting-anchored attendance: meetings come from the team **Google Calendar**, clocking in during a meeting auto-attaches the session to it, and each meeting has an attendance view. No required/excused concept observed, but the calendar-as-source-of-truth idea composes well with CH's policy layer.
- **GP** — general FullCalendar view (events + birthdays + notes + punches) but no required-day/excusal concept.
- **Decision:** Need · Preferred variant: CH's rich required/optional build-day calendar, but with Den's Google-Calendar-anchored attendance as the source of truth for meeting times.
- **Den** *(new variant — review)* — source confirms the mechanism: `node-ical` polls the team calendar's ICS feed into a `meetings` table with a mentor `endOverride` correction field; attendance views and the midnight sweep both key off it (`Den: server/calendar.ts`, `server.ts:1612-1731`). Also adds an **out-of-office/absence marking** per meeting day (`UNIQUE(memberId, day)`), a lighter cousin of CH's excusal workflow.
- **NT** *(new variant — review)* — meetings are first-class records a lead creates (title, window, hours, term/year), and **every meeting is created as a full + half-credit pair** (`parent`/`dependent` links) so partial attendance is a data-model concern, not a runtime calculation (`backend:.../attendance_controller.py create_meeting`).
- **[myWB-web](sources/mywb-web.md)** *(new variant — review)* — an **excused-absence request/verify state machine independent of hours logging**: a member submits a free-text reason (`status: unverified`), an admin surface flips it to `verified`, and the event recolors from "missed" to "excused" throughout the UI (`event_details_page.dart`). Flutter, ambiguous license.

### 1.7 Manual / offsite hours with mentor verification
- **Den only** — "Log Hours" for offsite work is recorded as *pending* until a mentor verifies; clock-ins outside any scheduled meeting are likewise flagged for review. In-meeting hours are trusted by default. A nice trust model: verification burden only where abuse is possible.
- **Decision:** Nice (later) — we can start with all hours trusted, and add mentor verification for offsite hours later if needed.
- **MD** *(new variant — review)* — same trust model generalized: self-reported checkouts and cap-exceeding sessions land in a flagged/approval queue with explicit admin approve/deny actions and notification of the result (`backend/app/api/routers/sessions.py`, `admin/src/pages/Approvals.tsx`).
- **NT** *(new variant — review)* — admin-entered manual hours use a sentinel `meeting_id = -1` enforced by a schema validator, keeping manual credit distinguishable from beacon-verified credit forever (`backend:.../attendance_schema.py`).
- **[FRC8729_attendance_bot](sources/frc8729_attendance_bot.md)** *(new variant — review)* — clock-out is **never self-committed**: every `/clockout` posts an Approve/Deny button card into an admin channel and blocks on a lead's decision before the elapsed hours are committed (deny = no hours) — applied to *every* clock-out, not only offsite/flagged ones as in MD/Den (`main.py`). Python/discord.js, MIT.
- *Also seen in round 3:* [FTC_AttendanceTracking](sources/ftc_attendancetracking.md) (offline-work submissions land in a `pending_approval` admin approve/reject/edit queue).

### 1.8 Time-clock periods (seasons)
- **GP only** — named date ranges (e.g. "2026 Build Season") that scope punches, with per-period permissions; keeps history separated by season. `app/models/time_clock_period.rb`.
- CH instead has a hard-coded `/reset_hours` cutoff date — a lesson in what *not* to do.
- **Decision:** Need · Preferred variant: GP
- **MD** *(new variant — review)* — `Season` owns the hour caps (daily/weekly/season) and has an explicit **rollover** operation: creating a new season closes the prior season's open sessions and resets cap counters (`backend/app/services/season.py`).
- **NT** *(anti-pattern, new variant — review)* — term/year windows are hardcoded Unix timestamps in backend config (`Config.SCHOOL_YEAR`) — a new season requires a code deploy; same lesson as CH's reset URL.
- **[lab-attendance-kiosk](sources/lab-attendance-kiosk.md)** *(new variant — review)* — the opposite discipline: a deliberate **never-shard-by-semester** policy where only a `00_config` toggle changes which date range is "current," keeping the full audit trail permanently queryable (`docs/operations/semester-transition-runbook.md`). The explicit counter-example to the anti-patterns below. FastAPI, no license.
- **[TeamPortal](sources/teamportal.md)** *(new variant — review; idea only, unimplemented)* — a described "New Season" rollover: bulk-export the whole tracker to Excel, then clear consents/hours/requirements and **auto-increment every student's grade level**, rolling 12th-graders to "Alumni" in one workflow (`admin/team-tracker.html`, modal copy only). Worth recreating with real transactional semantics if a grade-promotion rollover is ever wanted.
- *Also seen in round 3 (anti-patterns — reinforce the "use a season table" lesson):* [GOSAttendanceTrackerV2](sources/gosattendancetrackerv2.md) (year-sharded model classes `GosStudent2025`/`2026` copy-pasted each season), [kcq888](sources/kcq888-attendance.md) (season as a free-text string prepended to Firestore paths, client-side only); and [frcattend](sources/frcattend.md) / [teamforge](sources/teamforge.md) confirm the good pattern (configurable school-year windows / a `season_id` on every table).

### 1.9 Manual session editing / audit corrections
- **CH** — editors add/edit/delete sessions with arbitrary times and notes; "suspect sessions" report lists sessions > 18h (`get /suspect_lab_sessions`); date-range search.
- **GP** — same via punch CRUD + flagged-punch review; PaperTrail audit log records every change with revert.
- **Decision:** Need · Preferred variant: CH + GP
- **MD** *(new variant — review)* — admins can edit check-in/out times directly, force-checkout a member, and bulk end-of-day checkout-all; every admin action lands in an append-only `AdminEvent` audit table backing a read-only Audit Log page (`backend/app/api/routers/admin.py`, `admin/src/pages/AuditLog.tsx`).
- **Den** *(new variant — review)* — backdated clock-in is allowed but capped at 18h (`Den: server.ts:1436-1481`) — same "suspect threshold" number as CH, applied at write time instead of report time.
- **[attendance-manager](sources/attendance-manager.md)** *(new variant — review)* — attendance is an **append-only `attendance_events` log** with sessions derived at read-time via a SQL VIEW (correlated subquery pairing check-in→next check-out) rather than a stored mutable record; a standalone `validate:attendance` console command runs three re-runnable data-quality heuristics (stale checkouts, >12h sessions, simultaneous-duplicate taps) with `--detail`/`--fix` modes (`AttendanceEventController.php`, `ValidateAttendanceEvents.php`). Laravel, no license. (RoboLancers' raw `scan_events` → derived `attendance_sessions` split, below, is the same event-sourced idea.)
- *Also seen in round 3:* [GOSAttendanceTrackerV2](sources/gosattendancetrackerv2.md) (18h stale-login auto-expiry, same threshold as CH/Den), [deceptivehours](sources/deceptivehours.md) (bounded-window overlap-prevention scan before allowing clock-in/edit), [FRC-Attendance-System](sources/frc-attendance-system.md) (immutable `scan_events` vs rebuilt `attendance_sessions`, plus kiosk offline queue + idempotency key).

### 1.10 SMS interactions
- **CH only** — Twilio webhook: mentors text student IDs to sign them out (batch supported), `gtfo` closes all open sessions, `here` logs a mentor check-in (`post /sms`). README pegs cost ~$1/mo + $0.01/msg.
- **Decision:** Skip — we can start with kiosk sign-in/out and add SMS later if needed.
- **[JaguarRobotics/management-system](sources/management-system.md)** *(new variant — review)* — SMS via **phone-carrier email-to-SMS gateways** (`number@carrier-gateway.com`) instead of a paid API like Twilio — a zero-cost alternative, at the price of maintaining a per-carrier gateway map (`contacts.carrier` column, `MessagingController.java`). Java/Spark, no license.

### 1.11 Hour caps with threshold warnings *(new — MD)*
- **MD only** — configurable **daily / weekly / season hour caps** on the season; evaluated after every checkout with 80% and 100% threshold warnings, de-duplicated per period via a `HourWarning` row per (member, season, warning-type) so nobody is re-warned every checkout; crossing 100% flags subsequent sessions for admin review and notifies admins (`backend/app/services/hour_caps.py`). Exists because some teams/schools impose participation-hour limits; also useful inverted (minimum-hours eligibility).
- **Decision:**

### 1.12 Check-in identity hardening / anti-cheat *(new — MD, Den)*
- **MD** — device-fingerprint binding on first login (new device rejected until an admin runs a "transfer pass" reset), NFC payloads validated by a **server-recomputed HMAC** mixing a global secret with the member's own encrypted TOTP seed (clone-resistant), TOTP QR replay prevention via Redis (`backend/app/core/security.py`, `scan_validation.py`).
- **Den** — student ID numbers are never stored raw — only an HMAC-keyed hash for lookup (`Den: server/auth.ts hashLookup`); mentor PINs separately hashed; ID login rate-limited per IP.
- Both are answers to "buddy check-ins" / PII-at-rest concerns. MD goes further: all PII columns (name/email/phone) are pgcrypto-encrypted with an HMAC email hash for O(1) login lookup.
- **Decision:**
- *Also seen in round 3:* [GoS Admin Portal](sources/gos_admin_portal.md) (Fernet-encrypted PII fields with a documented key-rotation + re-encryption management command — same intent as MD's pgcrypto approach).

### 1.13 Per-session performance rating & qualitative notes *(new — round 3: ctrc-dashboard)*
- **[CTRC Dashboard](sources/ctrc-dashboard.md)** — layered on top of ordinary PRESENT/ABSENT/EXCUSED attendance: a **1–5 `DailyPerformance` rating** per student per session, plus a 280-char **"X-Factor"** tagged coach observation (e.g. "Leadership", "Breakthrough") for capturing qualitative moments (`prisma/schema.prisma` `DailyPerformance`, `XFactorNote`). A distinct capability from hours/attendance — turns each session into a coaching data point. Static JS + Netlify Functions + Prisma/Postgres (Caution Tape Robotics Club, VEX-comparable), no license.
- **Decision:**

### 1.14 Per-event check-in survey prompt *(new — round 3: frcattend)*
- **[FRC Attend](sources/frcattend.md)** — an optional question (multi-select or freetext, with "replace" vs "append" semantics) shown to each student at the moment of check-in — e.g. "how did you get here today" for carpool/logistics tracking (`src/frcattend/model/surveys.py`, `view/survey_screen.py`). Cheap way to attach structured data collection to the kiosk flow. Python/Textual/SQLite (IRS 1318), no license.
- **Decision:**

## 2. Roster / Membership

### 2.1 Member roster with profiles
- **GP** — richest: Person entity with names, gender/shirt-size (configurable option lists), phone, address, birthday, dietary restrictions, bio, avatar (with webcam capture), tabbed profile pages (`app/models/person.rb`, `app/views/people/`).
- **CH** — minimal Student (ID + name), synced from SSO.
- **AT** — roster rows in a Google Sheet (name, student flag, active flag, grad year).
- **Decision:** Need · Preferred variant: GP
- **NT** *(new variant — review)* — a **privacy-scoped directory endpoint**: all verified members can browse the roster, but the directory API strips email/phone/student-ID/push-token fields; the full record list is restricted to executive+ (`backend:.../account_service.py get_user_directory` vs `get_all_users`). A clean pattern for "roster visible to students, PII visible to mentors."
- **MD** *(new variant — review)* — **bulk CSV member import** (number/name/email/phone/role) creating accounts with generated passwords and season assignment (`POST /admin/import-members`) — the fastest cold-start path surveyed.
- **[frcattend](sources/frcattend.md)** *(new variant — review)* — student lifecycle is a **stored state machine** (`prospect → former_prospect|rookie → veteran → former_member|alumni`), each transition requiring a `reason` from a fixed set and validated against a `valid_prior_statuses` legal-transition table, with full status history retained and "as of a past date" roster queries (`src/frcattend/model/students.py`). Python, no license.
- **[bionic-attend](sources/bionic-attend.md)** *(new variant — review)* — **soft-delete-preserves-history**: hiding a user keeps all their attendance rows, a fresh check-in auto-un-hides them, and renaming an ID cascades transactionally to the user row *and* every historical attendance row (`edit.go`). Go/SQLite, no license.
- **[deceptivehours](sources/deceptivehours.md)** *(new variant — review)* — student grade is recorded once against a school-year anchor (`studentGradeAsOfSchoolYear`) and **auto-advances on display** by years elapsed (July-1 boundary), rolling to "Alumni" past grade 12 — no annual manual bump-up (`convex/studentInfo.ts`). Convex/Clerk, no license.
- *Also seen in round 3:* [FRC_Attendance-App](sources/frc_attendance-app.md) (same soft-delete-preserves-history pattern), [frc-project-management](sources/frc-project-management.md) (flat member contact-list directory), [TeamPortal](sources/teamportal.md) (a roster-compliance-checklist field taxonomy — permission slips, GPA standing, background/STIMS registration — though unwired), [team8/attendance-web](sources/attendance-web.md) (minimal first/last/email/subteam row).

### 2.2 Teams / subteams hierarchy
- **GP only** — self-referential team tree with team types (icon, custom "manager" title), membership with manager flag, join permissions (admin-added → open-join → requires-approval), membership application/approval queue (`app/models/team.rb`, `membership_application.rb`).
- **Decision:** Need · Preferred variant: GP
- **Den** *(new variant — review)* — flat `subteams` table with sort order; members carry one subteam + lead flag (`Den: server/db.ts`). NT similarly uses a subteam string list per user. Both confirm a flat list covers real-team needs; GP's tree is the outlier.

### 2.3 Roles & permissions (app-wide)
- **RAR** — full RBAC: roles (ADMIN/MENTOR/STUDENT_ADMIN/STUDENT/PARENT/GUEST) × 21 granular permissions, role-permission and direct user-permission joins, admin UI for assignment, permission-gated nav (`database/schema.ts`, `app/lib/user-permissions.ts`).
- **GP** — two boolean flags (admin/architect) + derived manager status + Pundit policies + per-model permission enums.
- **CP** — three-level enum (readonly/editor/admin) + enabled flag; simplest that works.
- **Den** — five roles (`admin`/`mentor`/`lead`/`student`/`guest`) plus server-configured superadmins; **guest read-only mode is server-enforced per endpoint**, not just hidden UI. Members carry role, subteam, grad year.
- **CH/CM** — permission strings from an external SSO.
- **Decision:** Need · Preferred variant: Den's five roles with server-enforced guest read-only mode. In the future, we can add RAR's RBAC schema for future extensibility.
- **Den** *(new variant — review, source-confirmed with one discrepancy)* — the mechanism is even better than observed: a **single permission map** (`src/permissions.ts`, action → minimum rank) imported by both the Express middleware (`server/acl.ts requirePermission`) and the UI gate (`src/acl.ts can()`), with a documented checklist (`docs/PERMISSIONS.md`) and a required test-matrix row per new action. **Discrepancy:** at the surveyed commit every action requires ≥ `student` rank, so a true no-session guest gets 401 everywhere — the live guest browsing v1 observed either ran an older config or has since been tightened. The *pattern* the v1 decision was based on (server-enforced per-endpoint gating from one source of truth) is fully confirmed; whether guests can actually browse is a config choice, not a mechanism limitation.
- **PT** *(new variant — review)* — `admin/engineer/viewer` per team membership, enforced **twice**: Postgres RLS policies via two `security definer` helper functions (`my_team_id()`/`my_role()`) called in every policy, plus per-action viewer checks in Server Actions (`PT: supabase/migrations/20260506000000_initial_schema.sql`). **Same Supabase stack as hub** — the RLS-helper-function pattern is directly adoptable if we ever move off zero-policy service-role-only RLS.
- **NT** *(new variant — review)* — six-level linear hierarchy (`unverified → member → leadership → executive → advisor → admin`) enforced by a `require_access(minimum_role=…)` decorator comparing hierarchy indices (`backend:.../routes/utils.py`) — the same rank-comparison shape as Den's.
- **FM** *(new variant — review)* — six **additive** roles (a user holds several: BUILD_LEAD, INVENTORY_ADMIN, BUDGET_MANAGER, SAFETY_CAPTAIN…) with HEAD_MENTOR as blanket superuser (`FM: src/lib/rbac.ts`) — role-per-responsibility rather than rank; interesting for module-owner delegation.
- **FO** *(anti-pattern, new variant — review)* — UI implies admin/owner gating but the server checks roles on almost nothing (any org member can advance/delete any order; `TODO.md` admits it) — a live example of client-side-only authorization drift.
- **[GoS Admin Portal](sources/gos_admin_portal.md)** *(new variant — review)* — a **DB-backed `(role, section) → (can_read, can_write)` permission matrix** (`RolePermission`) spanning ~18 sensitive data sections (medical, background checks, payments…), runtime-editable by Lead Mentors rather than hardcoded per-view — the most granular data-section RBAC surveyed, and the right shape if hub ever gates medical/PII fields separately from general roster. Django/Postgres, no license.
- **[management-system](sources/management-system.md)** *(new variant — review)* — permissions are a **MySQL `SET`-typed column of ~20 permission strings** (not fixed roles), enforced centrally by a declarative `@RequirePermissions({...})` method annotation the router checks before invoking the handler — decorator-driven authz like NT's, but per-permission not per-rank. Java/Spark, no license.
- **[savage-manage](sources/savage-manage.md)** *(new variant — review)* — a single flat **permission-flag catalog object drives three things at once**: the DB schema, a dynamically-built zod validator (`fillPermissions()`), and server-computed sidebar-nav visibility — adding a permission is a one-file edit. Next.js/tRPC/Prisma, no license.
- **[ftc-dashboard](sources/ftc-dashboard.md)** *(new variant — review)* — additive permissions as a **JSON scope-array** on the user rather than a role enum. Local-first, no license.
- **[ryver-latexbot](sources/ryver-latexbot.md)** *(new variant — review)* — two-axis model: a numeric **access-level** plus per-command **access-rule** overrides, so an individual command can be opened or restricted independent of the caller's level. No license.
- **[deep-blue-parts](sources/deep-blue-parts.md)** *(new variant — review)* — a dedicated **`shoptech` role split** out from general membership for shop-floor manufacturing users — role-per-context precedent for the design→mfg side. No license.
- *Also seen in round 3:* [teamforge](sources/teamforge.md) (role enforced at both a DB `CHECK` constraint and a centralized `withAuth`/`withAdminAuth` wrapper — belt-and-suspenders like PT's double enforcement; AGPL, ideas only), [frc-timetracker](sources/frc-timetracker.md) (claims-based Angular route-guard authz), [teammanager](sources/teammanager.md) (a non-functional "Email Viewers" cc-list group alongside Approvers/Purchasers).

### 2.4 Authentication
- **RAR** — Better Auth, email/password, cookie sessions (Node-native; closest to our stack).
- **GP** — Devise + OAuth sign-in (Google/Discord/GitHub), toggleable local signup, first-user-becomes-admin, auto-provisioned logins with generated passphrases.
- **CP** — local PBKDF2 + optional WordPress SSO; self-registration with admin approval + email notification.
- **Den** — split by audience: students sign in with a team ID number (low-friction, no passwords for minors), mentors with Google OAuth (allowlisted emails) or ID + PIN; self-service account request queue.
- **CH/CM** — external SSO only.
- Notable sub-features to consider: first-user-admin bootstrap (GP) vs DB-manual bootstrap (RAR's gap); registration-approval queue (CP, Den); admin impersonation with true-user audit (GP); per-audience auth methods (Den).
- **Decision:** Need · Preferred variant: Den's split-audience auth (student ID + mentor OAuth) with a self-service account request queue. Add first-user-admin bootstrap for initial setup.  Student's ID auth should also be compatible with OAUTH for future-proofing.
- **Den** *(new variant — review, source-confirmed)* — implementation details now visible: HMAC-signed cookie sessions, Google ID tokens verified server-side with `jose` against a DB-backed mentor allowlist + env superadmin list, per-IP rate limiting on ID login, `pending` accounts refused with a distinct message, and a **profile-completion gate** (name+email required before full access) (`Den: server/auth.ts`, `server.ts:527-770`, `src/components/ProfileGate.tsx`).
- **PT** *(new variant — review)* — username/password **on Supabase Auth** by synthesizing `${username}@frc-part-tracker.local` fake emails (`PT: src/app/actions/auth.ts`) — the workaround hub would also need if we ever want student usernames without real emails on Supabase Auth.
- **FM** *(new variant — review)* — registration is pending-approval **unless** the submitted team **access code** matches, which instant-activates the account (`FM: src/app/actions/auth.ts`) — a nice middle ground between open signup and a manual queue.
- **NT** *(new variant — review)* — registration **cross-references a pre-loaded directory** (student ID → expected name/grade); mismatches aren't blocked but are recorded as flags for the admin verification queue (`backend:.../account_controller.py cross_reference_studentID`).
- **FO** *(new variant — review)* — better-auth's `organization` plugin gives multi-team orgs, email invitations with accept links, pending-invite management, and per-session active-org switching essentially for free (`FO: server/utils/auth.ts`) — the strongest evidence yet for RAR's Better Auth instinct.
- **[7028-parts](sources/7028-parts.md)** *(new variant — review)* — a first-class **local/demo auth mode** (env `APP_MODE`) offering a shared `LOCAL_MASTER_KEY` + user-picker as an alternative to Google OAuth, so the app runs on a LAN with zero OAuth setup — useful for a build-season kiosk that must work when the internet doesn't. Next.js/Prisma, no license.
- **[myWB-web](sources/mywb-web.md)** *(new variant — review)* — the onboarding gate **stacks two checks**: a school-district email-domain allowlist at registration *and* a forced Discord OAuth handshake (a sentinel value marks "not linked") re-verified every login — stronger than a single allowlist. Flutter/Firebase, ambiguous license (ideas only).
- *Also seen in round 3:* [attendance-manager](sources/attendance-manager.md) (Slack OIDC as the sole auth provider), [runnymede](sources/runnymederobotics1310-cheesy-parts.md) (self-registration-pending-approval, identical to CP; BSD-2).

### 2.5 Parent/child & mentor relationships
- **GP only** — typed directional relationships between people (parent/child, mentor/mentee) with per-type creation permissions (`app/models/relationship.rb`). RAR's permission list hints at the same intent (`child:progress_view`) but nothing is built.
- **Decision:** Nice (later) — we can start with a flat roster and add typed relationships later if needed.

### 2.6 Badges / training & credentials
- **GP** — badges with types, colors, team scoping, permission-controlled awarding including self-award (`app/models/badge.rb`).
- **RAR** — "learnings management" (areas trained, pending training, coordinating mentor) is the stated goal in `docs/Home.md` but unimplemented.
- **Decision:** Nice (later) — we can start without badges and add them later
- **FM** *(new variant — review)* — certifications are **load-bearing**, not decorative: a tool marked `requiresCertification` blocks checkout unless the member holds an ACTIVE `UserCertification` for that name (`FM: src/app/actions/tools.ts`). If we ever do badges, tying them to tool/machine access is the version with teeth.
- **OT** *(new variant — review)* — a per-user `certified` boolean toggled by admins, display-only in the client (`OT: lib/ui/UserModal.dart`) — the minimal version.
- **[ctrc-dashboard](sources/ctrc-dashboard.md)** *(new variant — review)* — a full **curriculum system distinct from badges**: nestable `CurriculumModule → Lesson` (with quizzes) → per-student `CurriculumProgress` (status/score/evidence photo), plus a separate `Skill`/`StudentSkill` model with coach-verification and evidence — the "teeth" version of training tracking if hub ever moves past a flat badge list. JS/Prisma/Postgres, no license.

### 2.7 RFID / access tokens
- **GP only** — token entities attached to a person (or a hook), duplicate detection, reader-format normalization; used by the kiosk (`app/models/token.rb`).
- **Decision:** Nice (later) — we can start with no RFID tokens and add them later if needed.
- **MD** *(new variant — review)* — the wallet-pass NFC serial (`pass_serial` UUID + hashed auth token per member) is the modern equivalent: the "card" lives in the student's phone wallet, provisioned by one tap from the PWA, updatable by push (`MD: backend/app/services/apple_pass.py`, `google_pass.py`).
- **[GoS Admin Portal](sources/gos_admin_portal.md)** *(new variant — review)* — RFID lookup **tolerates leading-zero variants** from inconsistent reader firmware and self-heals the stored UID to canonical form on a stripped-form match — a real-world robustness fix for mixed-reader fleets. Django, no license.
- **[profile](sources/profile.md)** *(new variant — review)* — a keyfob is **granted by swiping it** during an admin-initiated enrollment window (swipe-to-bind) rather than typing the UID. No license.
- *Also seen in round 3:* [kcq888](sources/kcq888-attendance.md) (companion Raspberry Pi + RFID reader writing events straight into Firestore — the hardware-bridge precedent, though the bridge itself isn't in the repo).

### 2.8 Multi-team / multi-org membership & join codes *(new — PT, FO, FM)*
- **PT** — users belong to several teams via `team_memberships`; joining uses a 6-char **join code** (unambiguous alphabet), creating uses a name; an active-team pointer is cached on the profile; an `AFTER DELETE` trigger deletes a team when its last member leaves (`PT: supabase/migrations/20260507000001_team_memberships.sql`).
- **FO** — better-auth organizations with owner/admin/member roles, email invitations, and per-session active-org switching (`FO: server/utils/auth-schema.ts`).
- **FM** — team auto-created from the team number on first registration; a rotatable team access code doubles as the instant-join secret (`FM: prisma/schema.prisma`).
- Almost certainly YAGNI for a single-team hub (hub is one team by design), but the join-code UX is worth borrowing for account onboarding even in a one-team world.
- **Decision:**
- **[teamforge](sources/teamforge.md)** *(new variant — review)* — invite codes are generated by a Postgres function that combines `gen_random_bytes` with a **confusable-character substitution table** (0/O/1/I/l and slashes → safer glyphs) so codes read unambiguously aloud or off paper — a direct upgrade over PT's and FM's plain join codes for the onboarding-UX angle noted above. AGPL, ideas only.
- **[broncoparts](sources/broncoparts.md)** *(new variant — review)* — onboarding via a first-class **`RegistrationLink` invite entity** (a shareable link that provisions the new member into the right team/role) rather than a shared static code. No license.

### 2.9 Youth Protection compliance & escalation *(new — round 3: buildseason)*
- **[buildseason](sources/buildseason.md)** — a full Youth-Protection layer: creating a team **age-gates the creator** and requires designating a "YPP contact" adult, the team must always retain ≥1 YPP contact and ≥1 lead mentor, and every inbound message to the AI assistant runs a moderation pass (pass / flag-alert-mentor / block) that feeds a **mentor safety-alert pipeline** — Discord DM + email with click-acknowledge token links, severity levels, and escalation (`convex/lib/ypp.ts`, `agent/moderation.ts`, `safetyAlerts`/`alertAckTokens`). Convex/TS, no license (ideas only). Directly relevant to FRC's real YPP obligations if hub ever hosts minor-facing messaging.
- **Decision:**

### 2.10 Membership inactivity auto-deactivation *(new — round 3: profile)*
- **[profile](sources/profile.md)** — members who haven't been seen for a configurable window are **automatically flagged/deactivated** rather than lingering on the active roster indefinitely, keeping headcount and notification targeting honest without manual pruning. No license.
- **Decision:**

## 3. Parts & Purchasing (all CP unless noted)

### 3.1 Structured part numbering
Canonical numbers like `PREFIX-A-0100`/`PREFIX-P-0101` (project prefix + assembly/part letter + zero-padded number) intended as CAD filenames; auto-allocation: assemblies get +100 blocks, parts increment within their parent's block (`models/part.rb` `generate_number_and_create`).
- **Decision:** ✅ Done — shipped in [PR #74](https://github.com/RAR1741/hub/pull/74) (issues #8–#11). Ported to `src/lib/parts.ts`. Deviation from CP: **parts must belong to a parent assembly** (no loose top-level parts) so the per-project unique number can't collide between a top-level part and an assembly's first child.
- **PT** *(new variant — review)* — the same +100-block scheme independently reinvented (`26_A_100`, `26_A_200`…), plus a **naming-conformance flag**: free-text part names are checked against the expected number shape and non-conforming ones get flagged with a computed suggestion instead of a hard block (`PT: src/lib/validation.ts checkNamingConformance`).
- **KS** *(new variant — review)* — per-board configurable prefix + counter with per-subproject numeric offsets (`KS: boards.part_id_prefix`, `subprojects.part_id_offset`).
- **FB** *(new variant — review)* — configurable per-team number pattern with per-system subsystem codes, bulk generation, and an optional **write-back that renames the actual parts in Onshape** to match ("Sync to Onshape").
- **[austinbowles29 / 254](sources/austinbowles29-cheesy-parts.md)** *(new variant — review)* — subsystem-prefix-encoded numbers (Drive=0100, Bumpers=0200…) with the **direction reversed**: a helper derives and auto-selects the subsystem dropdown *from a pasted part number's 4-digit prefix*, so numbering and taxonomy stay consistent even when a human types the number first (`src/lib/part-numbering.ts`). Next.js/Airtable, **all-rights-reserved (ideas only)**.
- *Also seen in round 3:* [7028-parts](sources/7028-parts.md) (regex-validated ID baking team/season/robot/subsystem), [sidereal-parts](sources/sidereal-parts.md) (revision-tracked numbers with a supersession chain — one "current," older auto-archived via `supersededById`), [circuit-parts](sources/circuit-parts.md) (same `<prefix>-{A,P}-NN` scheme, recomputed by re-parsing — fragile), [broncoparts](sources/broncoparts.md)/[deep-blue-parts](sources/deep-blue-parts.md)/[nerdy-parts](sources/nerdy-parts.md)/[runnymede](sources/runnymederobotics1310-cheesy-parts.md) (all the upstream +100-block Cheesy Parts scheme rebuilt unchanged).

### 3.2 Assembly hierarchy
Parts nest under assemblies (self-referential tree), breadcrumb chain, sortable listings (`views/part_tree.erb`).
- **Decision:** ✅ Done — [PR #74](https://github.com/RAR1741/hub/pull/74). `part.parent_part_id` self-FK (CP's `0` sentinel → real `NULL`); breadcrumb + children list on the part detail page.
- **PT** *(new variant — review)* — same self-referential assemblies (real nullable FK, like our port), but parts↔assemblies are **many-to-many via a `bom_items` join** (a part can appear in several assemblies with per-assembly quantities), with an explicit merge flow for duplicate parts sharing one CAD identity (`PT: src/app/actions/parts.ts updatePart/mergeWithExistingPart`). Relevant if/when we import BOMs from CAD.
- **[circuit-parts](sources/circuit-parts.md)** *(new variant — review)* — a generic **polymorphic parent/child** relationship (Mongoose `refPath`: a parent can be assembly-or-project, a child assembly-or-part) plus a **materialized `path` breadcrumb array** on every node, so any node knows its full ancestor chain without recursive queries — the read-optimized shape if our tree ever gets deep. Express/Mongoose, no license.
- **[broncoparts](sources/broncoparts.md)** *(new variant — review)* — parts carry two extra self-ref FKs (`subteam_id`/`subsystem_id`) tagging an **"owning" subteam/subsystem independent of their parent/child position** in the assembly tree, surfaced via a derived-hierarchy endpoint — orthogonal ownership vs structural nesting. Flask/React, ambiguous license (ideas only).
- *Also seen in round 3:* [db_material](sources/db_material.md) (a 3-tier recipe/BOM bridge-table shape identical to PT's `bom_items`; MIT, code reusable).

### 3.3 Manufacturing status pipeline
20 color-coded statuses (designing → material → ordered → drawing → ready → cnc/laser/lathe/mill/… → done), inline AJAX status change from any list (`models/part.rb` `STATUS_MAP`).
- **Decision:** ✅ Done — [PR #74](https://github.com/RAR1741/hub/pull/74). 20-status pipeline in `src/lib/types.ts` (`STATUS_MAP`/`STATUS_TONE`); inline status change via a `PATCH /api/admin/parts/[id]` cell (replaces CP's jQuery AJAX).
- **PT** *(new variant — review)* — a 13-value enum grouped into **three named phases** (design_* → manufacturing_* → assembly_*) driving a phase-pipeline dashboard; grew 5→13 values across three migrations, leaving dead enum labels behind because Postgres can't drop enum values (`PT: supabase/migrations/20260523000000_phase_based_statuses.sql`) — a concrete cautionary tale for evolving our own status enum (prefer a lookup table or text + CHECK if churn is expected).
- **OMP** *(new variant — review)* — 13 statuses oriented around **machine routing** (Ready for Saw/Lathe/Mill/CNC Router/3D Printer/Laser… + Needs Powder Coat) rather than abstract stages (`OMP: board/index.html STATUSES`).
- **[frc-parts / SpikeParts](sources/frc-parts.md)** *(new variant — review)* — status isn't a hand-set enum at all: a **heuristic auto-router** (`detectStockType` from material + bounding-box aspect ratio ⇒ tubing/plate/block/round/print) assigns a named multi-step `routeTemplate` (waterjet/mill/…) whose per-step operation rows carry machine, actual-minutes, assignee, and completion gates (`requireFile`/`requireNote`); the part's status is **auto-derived by folding all operation statuses**, with a sticky `on_robot` human override. The most automated pipeline surveyed. Next.js/tRPC/Drizzle, no license (private).
- **[austinbowles29 / 254](sources/austinbowles29-cheesy-parts.md)** *(new variant — review)* — a `coerceStatus` **alias-normalization layer** tolerates messy free-text statuses typed straight into Airtable by non-technical staff, mapping them back to the canonical 7-stage enum — the pragmatic answer to "the spreadsheet is the source of truth and humans mistype." All-rights-reserved (ideas only).
- **[sidereal-parts](sources/sidereal-parts.md)** *(new variant — review)* — a **blocking-vs-automatic machine-occupancy rule**: a member may hold only one active *blocking* job (CNC) at a time, while *automatic* methods (an unattended 3D printer) don't occupy the operator — a generalizable concurrency constraint over the pipeline. No license.
- *Also seen in round 3:* [7028-parts](sources/7028-parts.md) (6-stage pipeline with an explicit legal-transition graph, collapsed to 4 on the dashboard), [aerie](sources/aerie-part-management.md) (4-stage review→CNC/hand-fab→completed with a revert action), [circuit-parts](sources/circuit-parts.md) (9-stage part / 5-stage assembly pipelines with per-machine ready states).

### 3.4 Shop dashboard (kanban)
Live board grouping parts by status, priority-ordered and priority-colored tiles, status filter, 10-second auto-refresh; per-project enable flag (`views/dashboard.erb`).
- **Decision:** ✅ Done — [PR #74](https://github.com/RAR1741/hub/pull/74). Board at `/shop/[projectId]` (`ShopBoard`): status-grouped, priority-colored tiles, URL-persisted status filter, 10s poll. Deviations from CP: parts are grouped under a standalone **`project`** table (not period/season-linked), and the board is **student-gated, not public/kiosk** (guests can't view it). Purchasing (§3.5–3.6) remains "later" (issues #12/#13, untouched).
- **HS** *(new variant — review)* — drag-and-drop between columns with **SSE push** instead of polling (in-process event bus, 25s heartbeat) (`HS: app/routes/api/kanban/events.ts`); columns stored as a single JSON config blob so adding/renaming a column needs no migration (integrity enforced app-side only).
- *Also seen in round 3:* [aerie](sources/aerie-part-management.md) (tab-grouped kanban: Review/CNC/HandFab/Completed/Misc), [floorrunner](sources/floorrunner.md) and [rhr-mfg](sources/rhr-mfg.md) (both push live via **Supabase Postgres-Changes Realtime** — a third transport alongside HS's SSE and our 10s poll).

### 3.5 Purchasing: order items → vendor orders
Line items auto-group into per-vendor open orders (typing a vendor finds-or-creates the order; blank vendor = "unclassified" bucket), vendor autocomplete, inline editing, Open → Ordered → Received lifecycle with tax/shipping/notes (`post /projects/:id/order_items`, `models/order.rb`).
- **Decision:** Nice (later)
- **FO** *(new variant — review)* — the purest modern take: a three-stage pipeline (`to_order → ordered → arrived`) as both a kanban board and a filterable table, with `orderedAt`/`arrivedAt` timestamps set on transition (preserved, cleared on move-back), per-org colored tags, running total-spend, and CSV export of the filtered view (`FO: app/pages/app.vue`, `server/api/orders/[id].patch.ts`).
- **PT** *(new variant — review)* — an **orders board grouped by vendor** that dedupes identical COTS parts across assemblies, sums required + spare quantities per line, flags lines missing vendor/SKU info, and lets one click mark a whole vendor group ordered/received cascading to every line (`PT: src/app/actions/orders.ts`) — CP's vendor-order auto-grouping reborn on a BOM.
- **FB** *(new variant — review)* — "Order mode": groups COTS parts by vendor, computes order qty = needed − in-stock + reserve, running estimated total, per-vendor CSV export for placing the actual PO.
- **FM** *(new variant — review)* — a 7-state `PurchaseStatus` lifecycle (DRAFT→SUBMITTED→APPROVED/DENIED→ORDERED→PARTIAL_RECEIVED/RECEIVED + CANCELLED) with approver + notes, confirmation number, actual total and expected delivery captured at mark-ordered (`FM: src/app/actions/procurement.ts`).
- **[cacao](sources/cacao.md)** *(new variant — review)* — an expense row carries **two independent state machines**: `status` (pending_approval→approved→purchased→reimbursed/rejected) and a separate `deliveryStatus` (ordered→shipped→delivered) — approval and shipment don't share one enum, so "approved but not yet shipped" is representable. SvelteKit/Convex, no license (ideas only).
- **[circuitrunner-po-management](sources/circuitrunner-po-management.md)** *(new variant — review)* — a **single PO split across multiple sub-orgs** by %/amount (`POOrganization`/`POAllocation`), with a field-level Firestore rule that lets a purchaser update status but not touch `budgetAllocated` — multi-org cost-sharing at the PO line. React/Firebase, no license (ideas only).
- **[buildseason](sources/buildseason.md)** *(new variant — review)* — a **global `vendors` table shared across teams** (contact info harvested from real vendor emails) + a per-team `teamVendors` override junction (account #, lead time, preferred) merged at read; plus a Resend inbound-email webhook → cheap Claude model with a JSON schema that **extracts vendor / order # / tracking / line-items from forwarded order-confirmation emails** rather than per-vendor parsers. Convex/TS, no license (ideas only).
- **[frc-timetracker](sources/frc-timetracker.md)** *(new variant — review)* — an **internal storefront** (browse catalog → cart → checkout → confirmation, admin order/payment reports, manual "mark paid", unpaid search) — the *selling-to-members* inverse of vendor purchasing (team apparel etc.), a purchasing surface none of the other tools cover. Angular, ambiguous license (ideas only).
- **[bertbot](sources/bertbot.md)** *(new variant — review)* — an email-reply-driven order-status loop: an attachment on a Trello card in "Orders Requested" emails the mentor, an **IMAP poller** scans the mentor's mailbox for a reply from that address and moves the card to "Orders Placed" — purchasing status advanced by the mentor simply replying to an email. Node, ISC-declared but no LICENSE file (ideas only).
- **[ctrc-dashboard](sources/ctrc-dashboard.md)** *(new variant — review)* — **automated invoice ingestion** from a connected Outlook mailbox: keyword-filters inbound mail for invoice/receipt, regex-extracts number/amount/date, and vendor-detects against a hardcoded keyword map (VEX/AndyMark/WCP/REV/McMaster) — spend captured from the inbox with no manual entry. JS/Netlify/Prisma, no license.
- *Also seen in round 3:* [runnymede](sources/runnymederobotics1310-cheesy-parts.md) (vendor-open-order auto-bucketing, identical to base CP; BSD-2), [db_material](sources/db_material.md) (supplier + commodity catalog CRUD with per-unit/per-pallet qty; MIT), [robotics-command-center](sources/robotics-command-center.md) (a 4-stage Wanted→Ordered→Shipped→Received procurement wishlist with cost rollups).

### 3.6 Spend & reimbursement reporting
Per-vendor spend stats with drill-down; per-purchaser reimbursed vs outstanding report driven by a `reimbursed` flag + "paid for by" field (`views/order_stats.erb`).
- **GP alternative** — full double-entry-ish ledgers: per-team ledgers with cached balances, entry splitting, inter-ledger transfers, receipts attached to entries, colored tags, budgets matched by tag within budget periods, and Stripe hosted-checkout payments into a ledger. Much heavier; aimed at team finance, not just purchasing.
- **Decision:** Nice (later) · Preferred variant: TBD
- **OT** *(new variant — review)* — a student-facing **reimbursement request** form: part name/link, recipient name, mailing address, and a required **receipt photo** captured by camera and uploaded to storage before submit (`OT: lib/ui/parts/PartReimburse.dart`) — the missing student-side half of CP's mentor-side reimbursed flag.
- **FM** *(new variant — review)* — budget as its own module: per-season `Budget` with 12 fixed category allocations, funding sources (sponsor/grant/fundraiser, pledged vs received), an expense log optionally tagged to a category and/or a purchase request, and commitment (pledged-not-spent) flags (`FM: src/app/actions/budget.ts`) — much lighter than GP's ledgers but covers the mentor questions.
- **[cacao](sources/cacao.md)** *(new variant — review)* — a **live Hack Club Bank (HCB) treasury sync**: a manual Sync button pulls cash balance, lifetime-raised, authorized cardholders, and the 10 most recent transactions straight from the real nonprofit-banking API — team finances reconciled against the actual bank, not a hand-kept ledger. No license (ideas only).
- **[circuitrunner-po-management](sources/circuitrunner-po-management.md)** *(new variant — review)* — **XLSX bank-statement bulk upload** reconciles posted debits against POs via many-to-many `poLinks[]` (each link an amount/%), and `recalculateAllBudgets()` recomputes every sub-org's spend from the full transaction set — statement-driven reconciliation. No license (ideas only).
- **[teammanager](sources/teammanager.md)** *(new variant — review)* — a spend dashboard that **auto-selects bucket granularity** (hour/day/week/month/year) from the chosen date range and renders two time series (request count + approved spend $) alongside aggregate totals. Django, MIT (code reusable).
- *Also seen in round 3:* [robowebproj](sources/robowebproj.md) (printable PO + printable BOM with a print stylesheet; no license, ideas only).

### 3.7 Purchase-request approval workflow (Den)
- **Den only** — students submit requests (item, qty, unit price, supplier, purchase URL, notes, SKU); status flows `pending` → `approved`/`rejected` → `completed` with decision notes and signed-off-by; **auto-fill from a pasted URL** via a server-side part scraper; reorder/restock prefill from an existing item; approved purchases import into inventory. Complements CP's vendor-order model: Den covers "may we buy this?", CP covers "what did we order and who gets reimbursed?".
- **Decision:** Nice (later)
- **Den** *(new variant — review, source-confirmed)* — routes and schema confirmed (`Den: server.ts:889-1011`, `requests` table); the URL auto-fill is a plain server-side scraper (`/api/scrape-part`), no LLM.
- **PB** *(new variant — review)* — the same workflow relocated into **Discord + Google Sheets**: students submit via `/requestpart` slash command (subsystem, link, qty, budget, priority), an Apps Script writes the sheet, an **LLM enriches** the request from the fetched vendor page (name/SKU/price/stock) with a hallucination guard that discards any SKU not literally present in the page HTML, and mentors approve by typing "Approved" in the sheet — which auto-creates an Orders row and hard-rejects over-budget requests (`PB: apps-script/Code.js`). The sheet *is* the admin console; no web UI at all.
- **FM** *(new variant — review)* — adds an **auto-approval threshold**: requests ≤ $50 and not EMERGENCY are approved instantly; everything else notifies every BUDGET_MANAGER/HEAD_MENTOR (🚨-prefixed for emergencies); denial requires a reason and notifies the requester (`FM: src/app/actions/procurement.ts AUTO_APPROVE_THRESHOLD`).
- **[robowebproj](sources/robowebproj.md)** *(new variant — review)* — **per-part approval decoupled from per-order approval** (`setPartsAdminApproval()` vs `setAdminApproval()`), so an admin approves some line items while holding or rejecting others — not all-or-nothing; the order is Locked while under review and auto-unlocked on rejection for re-edit. PHP/MySQL, no license (ideas only).
- **[teammanager](sources/teammanager.md)** *(new variant — review)* — the **supplier is auto-derived from a pasted link's domain** via `tldextract` at submission (no manual vendor entry), with a tri-state pending/approved/denied flag — lighter than Den's/PB's full page-scraping. Django, MIT (code reusable).
- *Also seen in round 3:* [circuitrunner](sources/circuitrunner-po-management.md) (event-driven email on every PO status transition), [savage-manage](sources/savage-manage.md) (a pending→approved/rejected→reimbursed pipeline with audit), [weymuth](sources/weymuth-inventory.md) (a request→approve/deny queue that gates "may I check this out of stock," not "may I buy").

### 3.8 Shop inventory & storage boxes (Den)
- **Den only** — parts catalog with supplier, stock quantity vs low-stock warning point, unit price, SKU, inventory-value rollup; low-stock badge; a registry of physical **storage boxes** each with a label, color tag, and shop coordinate (e.g. `B13`), so every part answers "which box, where"; Google Sheets bootstrap import with column mapping.
- **Decision:** Nice (later)
- **FM** *(new variant — review)* — **auto-reorder**: pulling stock below the item's min threshold synchronously creates a `ReorderRequest` for the configured reorder quantity in the same mutation — no human has to notice low stock (`FM: src/app/actions/inventory.ts acquireItemAction`); also distinguishes base stock from in-use items pulled onto a robot (source: KOP/FIRST-Choice/direct/donated) with defect-report rows.
- **FB** *(new variant — review)* — team-wide inventory separate from any robot's BOM, plus optional **Box Mode**: per-robot "In Box" vs team "in stock" vs BOM "needed" counts with a one-click move-to-box helper and a "ready to assemble" indicator; disabling Box Mode hides but never deletes counts.
- **OT** *(new variant — review)* — **barcode-scan inventory lookup** (camera or manual entry) with inline status/location editing on the result page (`OT: lib/ui/tools/ToolsPage.dart`, `BarcodeResultPage.dart`).

Round 3 surfaced a large cluster of inventory implementations — this is the most-reinvented feature in the whole survey. Genuinely distinct mechanisms:
- **[inventorysystembackend / 1318](sources/inventorysystembackend.md)** *(new variant — review)* — a **shared-shop-tablet kiosk UX**: barcode-scanner-as-keyboard focus-hijack capture, an on-screen touch keyboard, inactivity auto-redirect back to lookup, and a category-tree / location-tree / item-type-vs-item model where an item-type can be flagged `isLocation` (e.g. a bin is itself an item). Express/Prisma + Next.js, no license (schema/UX reference only — auth & history are stubs).
- **[inventory-system / 1073](sources/inventory-system.md)** *(new variant — review)* — an **append-only IN/OUT/VERIFY transaction ledger** (VERIFY = a physical-count reconciliation action, a first-class event) plus **Brother-QL thermal barcode-label printing** straight from the part record. Python/SQLAlchemy, MIT (ideas only).
- **[weymuth-inventory](sources/weymuth-inventory.md)** *(new variant — review)* — a **six-state inventory machine** (AVAILABLE|STORAGE|CHECKED_OUT|UNCLASSIFIED|REPAIR|RETIRED) with **nonce-gated move confirmation** (a short-lived server nonce keyed to the exact change) + a script-lock + an immutable TRANSACTIONS ledger per write; plus a student parts-request flow (≤50 line items) with per-line-item batched approve/deny/partial and adjustable qty. Google Apps Script/Sheets, no license (ideas only).
- **[voltec-inv / 6647](sources/voltec-inv.md)** *(new variant — review)* — **photo-as-location**: the "stored in" field is a *photograph of the shelf/bin*, not a string, plus an append-only per-item `grabbedBy[]` checkout ledger enforced against stock. MERN, GPLv3 (ideas only).
- **[team4099-inventory / 4099](sources/team4099-inventory.md)** *(new variant — review)* — **Jaro-Winkler fuzzy/typo-tolerant part search** ranking all items by name similarity with no search engine, plus a free-text bin field ("B4 Black Box"). Flask, GPLv3 (ideas only).
- **[pitassisstant_old / 604](sources/pitassisstant_old.md)** *(new variant — review)* — a loose **natural-language "where is X" search**: keyword extraction from a sentence (stopword-filtered), substring match against item names *and* free-text aliases, deduped and grouped by location, seeded from a human-editable flat-text format (`+Location` header, bare item lines, `-alias` lines). Java Swing, MIT (ideas only).
- **[frc-inventory-manager](sources/frc-inventory-manager.md)** *(new variant — review)* — a **three-type asset model** (product/case/tote) with an embedded `inCase{status,case,quantity}` sub-doc recording which case an asset is packed into, plus "checkout/check-in as an upserted order" (`findOneAndUpdate({assetTag, checkInTime:null}, …, {upsert:true})` = at most one open transaction per asset without a state machine). Node/Express/Mongo, no license.
- **[srobo inventory](sources/inventory.md)** *(new variant — review)* — a **git-as-database asset register**: location = the file's directory path, assemblies = recursive directories with an `elements:` child list, disposed/unknown = pseudo-locations, provenance from `git log`/`blame`, zero application code (~4,850 YAML files validated by CLI in CI) — a cheap pattern for a low-write, audit-heavy register. Student Robotics UK (comparable org), no license.
- **[quartermaster](sources/quartermaster.md)** *(new variant — review)* — a **cross-vendor `SkuAlias`** per catalog item (the same physical part under different vendor SKUs) plus a base `Item` with category-specific subclasses (a Bearing adds bore/flange/metric/OD/ID/width) via table-per-type inheritance — extend the catalog per category without an EAV blob. .NET/EF/Postgres, GPL-3.0 (ideas only).
- **[frc_api](sources/frc_api.md)** *(new variant — review)* — a **shared public parts catalog decoupled from private team inventory** via a nullable FK (`team_components.public_component_id`): a team "adopts" a catalog row into inventory, overriding name/vendor/qty/location locally, or keeps it freestanding; plus facet endpoints (`/categories`, `/vendors`, `/availability-statuses`) for a parts-browser filter UI. FastAPI/SQLite, no license.
- *Also seen in round 3:* [legoguy1000-frc-inventory](sources/legoguy1000-frc-inventory.md) (a catalog-SKU-vs-physical-unit split, same item-type-vs-item idea covered more fully by 1318), [inventory-radar-frc / 2720](sources/inventory-radar-frc.md) (per-location list with inline qty/location edit — impl is cautionary: duplicate pages, no security rules).

### 3.9 3D print queue (Den)
- **Den only** — job submission with model file upload, quantity, urgency-sorted queue, filament type/color, estimated time; named printer fleet with job assignment; Queued/Printing/Done/Failed/Cancelled lifecycle; per-job activity trail and completed archive.
- **Decision:** Nice (later)
- **Den** *(new variant — review, source-confirmed)* — implementation now visible: `multer` uploads capped at 100 MB, `printers`/`print_jobs`/`print_logs` tables, file re-download endpoint (`Den: server.ts:1013-1231`).

### 3.10 Product URL auto-fill & cross-vendor catalog search *(new — FO, PB, FB)*
- **FO** — pasting a vendor product URL auto-resolves title/variants/prices live (Shopify `/products.json`, BigCommerce GraphQL) via a companion scraper microservice (`vendord/`), which also mirrors whole vendor catalogs (AndyMark, REV, WCP, ThriftyBot…) into **MeiliSearch** for a public cross-vendor product search page with an "Add to order" deep link (`FO: server/api/vendors/index.get.ts`, `app/pages/search.vue`).
- **PB** — LLM-based enrichment of a pasted URL (name/SKU/price/stock) with an anti-hallucination SKU check (see 3.7).
- **FB** — links its COTS BOM rows against FRC Orders' catalog (the FO service above) by name search or pasted URL, single or bulk (100/pass) — evidence these tools are becoming an ecosystem: **FRC BOM and FRCTools Orders are integrated siblings.**
- Den's plain scraper (3.7) is the v0 of this. Note: hub could *consume* orders.frctools.com rather than rebuild catalog scraping.
- **[order-procrastinator](sources/order-procrastinator.md)** *(new variant — review)* — the **client-side, no-backend** angle: a browser extension detects which of four FRC vendor sites (VEX/AndyMark/WCP/The Robot Space) the tab is on, auto-navigates to that cart page, and scrapes it into a normalized `{name, number, url, vendor, price, quantity}` — cart capture without a scraper microservice. WebExtension/JS, MIT.
- *Also seen in round 3:* [rev_parts_tracker](sources/rev_parts_tracker.md) (a whole-vendor BigCommerce catalog import, paginated, stripping discontinued/hidden items; no license, ideas only).
- **Decision:**

### 3.11 BOM/CSV bulk import → orders *(new — FO)*
- **FO only** — upload a CSV (Part Number/Quantity/Description, headers auto-normalized), auto-search each row against the product catalog, conservative auto-match only on exact SKU equality (everything else left for manual confirmation), per-row variant adjustment, then bulk-create orders in one POST with batched vendor resolution (`FO: app/components/dashboard/Import.vue`, `server/api/orders/bulk.post.ts`). Explicitly designed around Onshape's BOM CSV export, with an in-app walkthrough.
- **[7028-parts](sources/7028-parts.md)** *(new variant — review)* — a **two-phase preview/commit** BOM import: the upload first creates a *preview* batch diffing each CSV row against existing parts by part number (CREATE/UPDATE/NO_CHANGE/ERROR), and a separate commit applies the batch transactionally + emits an audit record — so a bad CSV never half-imports. Next.js/Prisma, no license.
- *Also seen in round 3:* [rev_parts_tracker](sources/rev_parts_tracker.md) (a generic CSV bulk uploader shared across inventory and roster with per-row validation).
- **Decision:**

### 3.12 Robot BOM & FIRST $5k cost-cap compliance *(new — FM)*
- **FM only** — per-robot BOM line items (unit/total fair-market value, source, KOP / FIRST-Choice / under-$5 exemption flags) with a live computed "countable FMV" against FIRST's $5,000 robot cost limit, a color-coded progress bar (80%/95% thresholds), an unconfirmed-FMV warning banner, and a **FIRST-format compliance CSV export** with an audit record per export (`FM: src/app/(app)/budget/bom/page.tsx`, `src/app/api/bom-export/route.ts`). The only surveyed tool that implements the actual game-manual cost rule.
- **Decision:**

### 3.13 Tool / equipment tracking & checkout *(new — FM, OT, HS)*
- **FM** — the fullest: tool catalog (type, shop-only vs travels-to-competition, condition, maintenance interval, replacement cost), quantity-aware **checkout/check-in** with certification gating (see 2.6), return-condition capture that downgrades the tool's condition if returned damaged, and maintenance logs (`FM: src/app/actions/tools.ts`).
- **OT** — tool **reservation queues** (waitlist per tool, not single checkout), category cards with per-tool status dots, long-press to report broken/back-in-service, admin add/remove (`OT: lib/ui/tools/`). Also a nightly cron that resets all reservations (`.github/workflows/mongo.yml`).
- **HS** — an **equipment registry** (name, location, status, documentation link, images) tagged with which manufacturing processes each machine supports (`HS: app/routes/api/equipment.index.ts`).
- **[rev_parts_tracker](sources/rev_parts_tracker.md)** *(new variant — review)* — **quantity-aware checkout with a per-item loaner toggle** at dispensing and a distinct admin "mark loaner returned" workflow that stamps `loanerReturned`/`At` on the original transaction — checkout and loaner-return are two mutations on one record, not a reservation system. Next.js/Firebase/Dexie, no license (ideas only).
- *Also seen in round 3:* [frc-shop-tool-tracker / 6632](sources/frc-shop-tool-tracker.md) (QR-tag tool lookup — concept only, unimplemented), [floorrunner](sources/floorrunner.md) (a machine roster with a running/idle/down/maintenance status enum).
- **Decision:**

### 3.14 Package/shipment tracking *(new — OT)*
- **OT only** — ordered parts carry a tracking number + carrier (Amazon/FedEx/UPS/USPS); the backend evidently polls a shipment-tracking API and the client maps raw carrier states to Ordered/Shipped/Arrived color coding on the shared shopping list (`OT: lib/services/database.dart Part`). Answers the shop-floor question "where's my part?" without anyone checking email.
- *Also seen in round 3:* [circuit-parts](sources/circuit-parts.md) (a per-order tracking sub-object — carrier + tracking number — with a tracking modal, same shape as OT).
- **Decision:**

### 3.15 Robot weight-budget / 125 lb compliance tracking *(new — round 3: claude4frc)*
- **[claude4frc](sources/claude4frc.md)** — pulls per-part mass properties from Onshape (kg→lb) and tracks them against FRC's 125 lb robot weight limit — the **mass analogue of 3.12's $5k cost cap**. No surveyed tool implements a live weight-cap dashboard; this is the closest, via an MCP tool (`get_mass_properties`). Python/MCP, no license (ideas only).
- **Decision:**

### 3.16 Inter-team surplus parts exchange *(new — round 3: partexchange)*
- **[partexchange / 3184](sources/partexchange.md)** — a public **post-a-request → other-teams-offer → mark-filled marketplace** (one account per FRC team #), region/district tagging, distance search backed by TBA-auto-geocoded team lat/lng at signup, crowd-flag moderation (auto-unverify at 3 flags), and a weekly opt-in digest + immediate new-listing fanout to same-region teams. A genuinely cross-team feature — distinct from the single-team purchasing of §3.5–3.7. PHP/MySQL, no license (ideas only). *(Also see [pitassisstant_old](sources/pitassisstant_old.md)'s informal inter-team borrow/lend ledger — item + team number, in/out — a minimal cousin.)*
- **Decision:**

### 3.17 Grants & sponsor/donor CRM funding pipeline *(new — round 3: cacao)*
- **[cacao](sources/cacao.md)** — the **funding-intake side of team finance** (the inverse of spending): a 6-column kanban for grant applications (requirement checklists, deadline urgency, per-column $ totals) plus a tiered sponsor/donor CRM with stale-contact detection (>9 months). SvelteKit/Convex, no license (ideas only).
- **Decision:**

## 4. Communications

### 4.1 Mailing lists (email distribution)
- **CM** — receives mail at `parents@`/`students@` addresses, checks sender permission, fans out one SES email per recipient with branded template, per-recipient signed unsubscribe links, reply-forwarding via base32-encoded return addresses, attachment re-hosting, dedup, throttling, Slack cross-post, blog cross-post. A full custom SMTP daemon — high ops burden to recreate as-is; the *feature* (permission-gated announcement email to parent/student lists) can be had with a simple compose-UI + email API instead.
- **GP** — announcement email blast (checkbox on an announcement fans out HTML email) + weekly personalized digest of announcements per user (`announcement_notification_router.rb`, `infodump.rb`).
- **Decision:** Nice · Preferred variant: TBD
- **FO** *(new variant — review)* — transactional email done the modern cheap way: **Resend + Vue Email component templates** for invites and order lifecycle events, with per-user notification preferences (per-event toggles + opt-in daily digest with a send time) and a `notificationLog` audit of every send (`FO: server/utils/email-service.ts`, `notificationPreferences`). This is the shape hub's "outbound email later" would take (Resend was already v1's recommendation).

### 4.2 Announcements (in-app)
- **GP only** — Markdown announcements with visibility windows, team-scoped or global, surfaced on dashboard and team pages.
- **Decision:** Nice · Preferred variant: GP
- **NT** *(new variant — review)* — a lightweight in-app "updates" ribbon: executive+ post/edit/soft-delete short announcements; everyone fetches the active list (`NT: backend:.../notification_routes.py`).
- **Den** *(new variant — review)* — a superadmin-authored **"What's New" changelog** (version, type, title, body) as a distinct feature from announcements (`Den: server.ts:397-527`) — worth stealing for hub itself as we ship features to the team.
- **[second](sources/second.md)** *(new variant — review)* — a message board that **targets members by a glob-matchable group/tag pattern**, with an optional "require accept" acknowledgment shown during clock-in before the member can proceed — announcement + forced-read receipt in one. Flutter/Sheets, GPL-3.0 (ideas only).

### 4.3 Slack/chat notifications
- **CM** — posts student-list mail to a Slack webhook with `<!channel>` ping. Trivial to recreate (one webhook POST).
- **Decision:** Nice · Preferred variant: CM (this should be one of the first things we implement post v1, since it's easy and useful).
- **OMP** *(new variant — review)* — beyond bare webhooks: posts **rich fielded Slack card messages** per manufacturing part (machine/material/finish/quantity/assignee) plus rows in a **Slack List** with typed columns, and uploads STEP/PDF files via Slack's external-upload API (`OMP: api/slack.js`) — Slack as a first-class UI surface, not just a ping.
- **NT** *(new variant — review)* — a public website contact form relayed to a **Discord webhook** as a rich embed with `@everyone`/`@here` neutralized (`NT: backend:.../notification_controller.py send_contact_form`).
- **DZ** *(new variant — review)* — `schedulesend`: one-off future-dated messages scheduled to a channel with list/delete management and restart-surviving timers (`DZ: dozer/cogs/management.py`) — "meeting reminder tomorrow 6pm" without a calendar system.
- **[ftc-dashboard](sources/ftc-dashboard.md)** *(new variant — review)* — a genuine **in-app real-time WebSocket chat** (not a Slack/Discord fan-out) with @-mention notifications, file attachments, and soft-delete, plus a separate outbound comms-log — the "build the chat surface yourself" alternative to depending on Discord. React/Express, GPL-3.0 (ideas only).
- **[austinbowles29 / 254](sources/austinbowles29-cheesy-parts.md)** *(new variant — review)* — a **bidirectional Onshape-CAD-comment ↔ Slack-thread relay**: CAD comments post to Slack, Slack replies thread back to the same CAD comment, and per-request status notifications update in-thread (`slackMessageTs` per request) — CAD and chat kept in one conversation. All-rights-reserved (ideas only).
- **[frc-attendance-system / RoboLancers](sources/frc-attendance-system.md)** *(new variant — review)* — every notification (absence-digest email, Discord pings) is **deduped via a `notification_deliveries` ledger** keyed by kind+recipient, with a "preview who would be contacted" mode and an explicit `resend:true` override — no accidental double-pings. CF Workers/D1, no license.
- *Also seen in round 3:* [frc-calendar-to-ical](sources/frc-calendar-to-ical.md) (a weekly Slack digest via Cloudflare Cron + webhook, sourced from the calendar).

### 4.4 Q&A board
- **GP only** — team-scoped questions, threaded replies, one-vote-per-person promoting best answers, close/reopen/move moderation.
- **Decision:** Nice · Preferred variant: GP

### 4.5 Inbound mailboxes (shared inbox archive)
- **GP only** — registered addresses whose inbound mail (via Postmark) is stored, searchable, with attachments.
- **Decision:** Nice · Preferred variant: GP

### 4.6 Suggestion box & in-app notifications
- **Den** — public "suggest an idea / report a bug" dialog categorized by app module, reviewed by mentors; per-user notifications for events like new purchase request or new suggestion (`/api/me/notifications`).
- **Decision:** Nice · Preferred variant: Den
- **MD** *(new variant — review)* — a full two-sided **message center** (member + admin) fed by session approvals/denials, geofence events, hour-cap warnings, and location-permission-denied alerts, with unread-count badge and mark-all-read (`MD: backend/app/api/routers/notifications.py`); mirrored to real push (APNs/FCM).
- **FM** *(new variant — review)* — a 17-type notification enum with role-targeted fan-out (`notifyTeam`) from purchase and membership events; bell/list UI with mark-read (`FM: src/app/(app)/notifications/`). (Several enum types are schema-only — the wiring lags the taxonomy.)
- **[frc-timetracker](sources/frc-timetracker.md)** *(new variant — review)* — **per-student canned reminder/warning messages** attached to an individual member, auto-shown in a modal the next time they sign in/out at the kiosk — targeted nudges surfaced at the exact moment of contact. Angular, ambiguous license (ideas only).

### 4.7 Discord/Slack bot as a team interface *(new — PB, DZ, OMP)*
- **PB** — the whole purchasing intake lives in Discord slash commands (`/requestpart`, `/orderstatus`, `/openorders`, `/inventory`) against a Sheets backend (see 3.7) — zero web UI for students.
- **DZ** — the community-scale reference for Discord-native team ops: self-service role menus (reaction roles, giveable roles with hierarchy checks), new-member **verification gates** with auto-kick deadlines, role persistence across leave/rejoin, mod-log + message/nickname logging, modmail (DM↔staff-channel bridge), scheduled announcements, and TBA team/event lookups (`DZ: dozer/cogs/roles.py`, `moderation.py`, `tba.py`). Explicitly multi-guild — a single-team tool would invert its "self-reported team association" into one canonical verified roster.
- **OMP** — Slack as the notification/worklist surface for manufacturing (see 4.3).
- Design question for hub: is Discord/Slack a *notification target* (webhook, cheap) or an *input surface* (bot with commands, a whole second frontend to maintain)?
- **[buildseason](sources/buildseason.md)** *(new variant — review)* — the bot is a **tool-calling Claude agent** as the primary interface: team-scoped tools over BOM/orders/parts/members/events, with an append-only `agentAuditLogs` capturing every message, tool I/O, and safety flag separate from the rolling context — the most ambitious "chat is the whole app" take, and directly the modern shape if hub ever wants an AI ops assistant. Convex/TS + Claude Agent SDK, no license (ideas only).
- **[workorder](sources/workorder.md)** *(new variant — review)* — a full **build-task lifecycle as Discord slash commands *and* interactive buttons** on one embed "card" kept in sync with the DB on every mutation, with per-action ownership/role rules and a shared `logAction()` → immutable audit — Discord as the entire interface for a manufacturing-claim workflow (distinct from PB's purchasing intake). TS/discord.js + Supabase, MIT.
- **[casserolediscordbotpublic / 1736](sources/casserolediscordbotpublic.md)** *(new variant — review)* — bridges a **physical USB conference speakerphone into a Discord voice channel** so the shop floor dials into meetings without a laptop, plus fuzzy free-text command routing (multiplicative scoring) instead of slash commands. Python/discord.py on a Pi, MIT.
- **[profile](sources/profile.md)** *(new variant — review)* — **Discord role as a membership badge**: `/link` HMAC-signs a Discord↔member binding, and a scheduled job adds/removes the "member" role from active-membership state (Stripe webhook → Keycloak group → Discord role) — the role is a byproduct of billing/membership, not manually granted. Go, MIT.
- *Also seen in round 3:* [bertbot](sources/bertbot.md) (Trello-activity → Discord mirror, ~15 event types with per-type toggles; ISC-declared, ideas only), [frc-discord-bot / 5190](sources/frc-discord-bot.md) & [frcbot](sources/frcbot.md) & [frc-slack-bot / 1721](sources/frc-slack-bot.md) (chat-command surfaces wrapping TBA lookups — thin), [ryver-latexbot / 6135](sources/ryver-latexbot.md) (a clean TBA API wrapper with Markdown cards; MIT), [frc8729_attendance_bot](sources/frc8729_attendance_bot.md) (Discord slash-command as the check-in interface).
- **Decision:**

### 4.8 Personal keyword-watch subscriptions *(new — round 3: ryver-latexbot)*
- **[ryver-latexbot / 6135](sources/ryver-latexbot.md)** — **Keyword Watches**: a per-user, cross-chat keyword subscription ("notify me whenever X is mentioned anywhere") — a *personal-subscription* notification model distinct from team-wide announcements/digests/webhooks. MIT.
- **Decision:**

### 4.9 Local-LLM club-ops assistant *(new — round 3: ftc-dashboard)*
- **[ftc-dashboard](sources/ftc-dashboard.md)** — an ops assistant routed through a **local Ollama/GGUF model (no cloud key)**: attendance-excuse triage against a criteria string, and AI activity-summary narratives (attendance/tasks/budget/outreach), with a resumable-stream session table for reconnect-safe SSE. Likely out of scope for v1, but a distinct capability class (and the privacy-preserving counterpart to buildseason's cloud-Claude agent). GPL-3.0 (ideas only).
- **Decision:**

## 5. Events & Calendar

### 5.1 Events with check-ins
- **GP only** — events with types, team scoping, location, times, optional attendance cap, check-ins carrying custom per-event-type fields, drag-and-drop "arrange" board grouping attendees by a field, printable grouped rosters (`app/controllers/events_controller.rb`, `checkins_controller.rb`).
- **Decision:** Nice · Preferred variant: GP
- **RR** *(new variant — review; out-of-rubric but adjacent)* — RoboRegistry is a **multi-team event registrar** for scrimmages/off-season events rather than an internal tool, but its check-in mechanics are worth noting if hub ever hosts outreach events: QR-code self check-in with a 4-digit PIN fallback, anonymous walk-in capture, a **kiosk "driver" mode** that logs the station out and iframes the check-in flow for a shared tablet, printable paper check-in sheets as fallback, and a public/private data split (public tree holds display strings; PII lives in an owner-only tree) (`RR: src/events.py`, `src/img.py`). GPL-3.0 — ideas only.
- **[savage-manage](sources/savage-manage.md)** *(new variant — review)* — **per-event opt-in feature toggles** (`useAttendance`, `useRSVP`) each with its own config field (`attendanceTimeout` minutes / `rsvpBefore` days), so one `Event` model serves plain, RSVP-only, and attendance-tracked events without separate tables — the clean way to make check-ins optional per event. Next.js/tRPC/Prisma, no license.
- *Also seen in round 3:* [buildseason](sources/buildseason.md) (an event calendar with RSVP going/maybe/not_going, no hours).

### 5.2 Team calendar
- **GP** — FullCalendar month/week/list merging events, birthdays, notes, punches; localStorage view toggles.
- **CH** — the attendance-specific build-day calendar (see 1.6).
- **Den** — no in-app calendar UI; meetings are read from the team's Google Calendar and used as the attendance backbone (see 1.6).
- **Decision:** Need · Preferred variant: CH's rich build-day calendar for required/optional days, but with Den's Google-Calendar-anchored attendance as the source of truth for meeting times.
- **Den** *(new variant — review, source-confirmed)* — the Google Calendar read is an **ICS feed poll via `node-ical`** (`Den: server/calendar.ts`) — no OAuth, no Google API quota, just the calendar's secret ICS URL. The cheapest possible calendar-as-source-of-truth implementation and probably exactly what hub should do.
- **[frc-calendar-to-ical](sources/frc-calendar-to-ical.md)** *(new variant — review)* — scrapes the **FIRST season calendar page → a subscribable ICS feed**, deriving each event's start/end/timezone from the site's own "Add to Google Calendar" deep-link (not from freeform text parsing), edge-cached with a manual `?bypass=true` refresh — the inverse of Den (publishing an ICS rather than consuming one). Cloudflare Worker, no license.
- **[teamforge](sources/teamforge.md)** *(new variant — review)* — recurring events (daily/weekly/monthly/yearly, custom interval, day-of-week set) with the recurrence rule **DB-`CHECK`-constrained** to require either an end date or an occurrence count — the schema itself prevents an unbounded recurrence. AGPL, ideas only.
- *Also seen in round 3:* [profile](sources/profile.md) (a team calendar sourced from the Discord scheduled-events API, RRULE-expanded — a third calendar-source pattern alongside Den's ICS and the FIRST-site scrape).

### 5.3 Task boards & Gantt (project planning)
- **Den only** — multiple named kanban boards (To Do / In Progress / Done, drag-and-drop) with cards carrying assignee and date ranges; **dependency-aware auto-scheduling** ("blocked by" → card starts the day after its blockers finish); per-board Gantt timeline with unscheduled bucket and today marker.
- **Decision:** Nice (later) — we already have some tools to do this; we can look into adding/integrating them at a later date.
- **Den** *(new variant — review, source-confirmed)* — the auto-scheduler is a small cycle-safe pure function (`Den: src/scheduling.ts scheduleTasks`), not a library.
- **KS** *(new variant — review)* — the most complete task system surveyed: boards typed blank/parts/software with **user-defined custom card fields** (schema editor per board), assignment to a user, a group, "anyone", or "looking for volunteer", card dependencies feeding a unit-tested Gantt layout, and a per-user productivity **leaderboard** driven by cards entering a "completed" column (`KS: sk/src/lib/components/gantt/layout.ts`, `pb/pb_hooks/leaderboard.js`). MIT.
- **FM** *(new variant — review)* — a hardcoded 20-item **standard FRC build-season milestone template** (offsets relative to kickoff/Week 0) applied in one click, plus a hand-built Gantt with non-build-day shading from the season's configured meeting days (`FM: src/app/actions/templates.ts`, `src/app/(app)/schedule/gantt/page.tsx`).
- **[cheesy-action-items / 254](sources/cheesy-action-items.md)** *(new variant — review)* — an **automatic accountability grade from completion timeliness**: 4+ days early = 110% bonus, 0–3 days early scales 100→110%, late decays exponentially with a one-week half-life (`0.5**(days_late/7)`), recomputed on close and never editable — turns task timeliness into a per-member score without manual grading. Ruby/Sinatra, BSD-2.
- **[workflow-management-system](sources/workflow-management-system.md)** *(new variant — review)* — **weekly per-person capacity planning**: available minutes vs planned minutes per task with over/under flags and workload %, plus a 3-week-forward forecast bucketed by deadline week (including unscheduled and overdue-carried-forward buckets) — the resource-planning layer above a plain task board. Next.js/Supabase, no license.
- *Also seen in round 3:* [frc-project-management / 1245](sources/frc-project-management.md) (personal task panel + assign-with-due-date + past-due report), [workorder](sources/workorder.md) (a single-item claim/assign/finish lifecycle as a Discord card), [savage-manage](sources/savage-manage.md) (task lifecycle with an evidence-required-before-complete gate).

### 5.4 Safety & compliance checklists *(new — FM)*
- **FM only** — safety incident reporting (severity, immediate/corrective action), a one-click seeded **19-item FIRST robot-inspection checklist** (weight, frame perimeter, bumpers, main breaker, pneumatics ≤120 PSI, RSL, software versions, BOM ≤ $5k…) with per-item pass/fail per event, and a (schema-only) pre-match checklist (`FM: src/app/actions/safety.ts`).
- **Decision:**

## 6. Reporting & Exports

- **CSV exports** — CH: hours CSV and attendance-percentage CSV (`get /csv_report`, `get /csv_attendance_report`). CP/GP/RAR: none.
- **Ad-hoc admin reports** — GP: named Ruby snippets run on demand (powerful but `eval`-based — recreate as saved SQL/typed queries, not code eval).
- **Spreadsheet-native reporting** — AT: all analysis in Google Sheets formulas; the app only writes rows. A lesson worth noting: mentors like spreadsheets — a "sync/export to Sheet" feature may beat in-app charts.
- **Audit log** — GP: PaperTrail on a second database, filterable admin browser, per-change diff and revert. Den: role-gated "Workspace Audit Trail" (`/api/audit`).
- **Decision:** Nice · Preferred variant: We don't need full audit logging, or CSV export, but some nice overall dashboards for admins and mentors would be good.
- **MD** *(new variant — review)* — CSV (BOM-prefixed for Excel) **and styled PDF** (ReportLab, subtotal tables) attendance exports with selectable columns (`MD: backend/app/services/export.py`); append-only `AdminEvent` audit table.
- **NT** *(new variant — review)* — mobile-side CSV export of the filtered admin attendance table via the OS share sheet (`NT: frontend:.../AttendanceManagementScreen.tsx`).
- **KS** *(new variant — review)* — audit trail with **JSON diffs per change** (`changes` column) and denormalized preview views for a fast activity feed (`KS: activity_log`, `pb/pb_hooks/activity_log.js`); Den's audit trail is likewise role-filtered (leads see student/lead/system rows, mentors see all — `Den: server.ts:146-173`).
- **FM** *(new variant — review)* — the BOM compliance CSV records every export (who/when/format) in a `BomExport` audit table — export-as-auditable-event is a nice touch for anything compliance-shaped.
- **[ctrc-dashboard](sources/ctrc-dashboard.md)** *(new variant — review)* — a generic **`ExportToken`** model (entity-type, expiry, max-access-count, optional password) issues shareable *revocable read-only links* to report cards / profiles / summaries — parent-facing sharing without giving parents accounts. JS/Prisma, no license.
- **[workflow-management-system](sources/workflow-management-system.md)** *(new variant — review)* — a reporting rule that places a completed task on the date of its **last actual logged work** (`time_entries.work_date`), not its deadline, falling back to the deadline only if no time was logged — an anti-gaming "what really happened" nuance for activity reports. Next.js/Supabase, no license.
- *Also seen in round 3:* [gos_admin_portal](sources/gos_admin_portal.md) (an append-only immutable `AuditLog` with before/after JSON diffs, save/delete overridden), [cheesy-action-items](sources/cheesy-action-items.md) (before/after JSON-snapshot change log diffed on read), [robowebproj](sources/robowebproj.md) (printable PO/BOM with a print stylesheet), [austinbowles29](sources/austinbowles29-cheesy-parts.md) (schema-read-driven dropdowns — Subsystem/Vendor pulled live from the Airtable field schema, the same "mentors edit the taxonomy in a spreadsheet, no redeploy" lesson as AT).

## 7. Platform / Admin plumbing (patterns worth copying, not user features)

- **Feature toggles** — GP gates every module (badges, events, ledger, Q&A, …) behind a boolean setting that hides routes/nav/search. Lets us ship v1 small and grow.
- **Runtime settings UI** — GP admin screen for site name, timezone, option lists, toggles (but stored in a PStore file requiring restarts — use a DB table instead).
- **Theming** — GP: logo upload, CSS variables, PWA colors; RAR: Tailwind brand theme + dark mode.
- **PWA** — GP: installable manifest + service worker stub.
- **Kiosk resilience** — AT: offline config cache, connection-status lights, input lockout when the backend is unreachable, WebSocket auto-reconnect. Directly relevant if our kiosk runs on flaky shop Wi-Fi against a cloud backend.
- **Admin impersonation** — GP (`pretender`) with true-user audit trail.
- **Guest read-only mode** — Den: unauthenticated visitors get a server-side downgraded session that can browse everything except role-gated endpoints — great for parents/sponsors, and forces clean server-side authorization from day one.
- **Health endpoint, background-jobs dashboard** — GP (`/up`, Mission Control).
- **Decision (which patterns to adopt):** Guest read-only mode (Den) is the only one I want to be included with v1; the others should be backlogged for later consideration.
- **Den guest mode** *(new variant — review — affects the adopted pattern)* — with source in hand: the mechanism (one `action → minimum rank` permission map enforced by server middleware and mirrored in the UI) is confirmed and excellent, **but at the surveyed commit no action is guest-visible** — rank 0 gets 401 everywhere, stricter than the live browsing v1 observed. For hub this means: adopt the single-permission-map mechanism, and make "which actions are rank-0 visible" an explicit list we own — Den shows the same machinery supports both a browsable guest mode and a locked-down one by config alone. (`Den: src/permissions.ts`, `server/acl.ts`, `docs/PERMISSIONS.md` — the docs also require a test-matrix row per gated action, worth copying.)
- **Kiosk/offline resilience** *(new variants — review)* — MD: AES-encrypted local member cache + bounded SQLite offline event queue (drop-oldest backpressure) synced on reconnect (`MD: scanner/src/offline.py`); NT: an app-wide **offline request queue** persisting every mutation to AsyncStorage and auto-replaying on reconnect, honoring `Retry-After` on 429 (`NT: frontend:.../NetworkingContext.tsx`). Both are stronger versions of AT's kiosk-resilience thinking.
- **Debug-flag production guard** *(new — MD)* — a config validator hard-fails startup if the skip-scan-validation debug flag is enabled while the DB isn't localhost (`MD: backend/app/core/config.py`) — a pattern worth copying for any dev-only bypass hub grows (e.g. our dev-login buttons).
- **Security-definer RPCs for cross-cutting writes** *(new — PT)* — every operation that must bypass a user's RLS scope (team creation, join-by-code, role changes, secrets) is a Postgres RPC in a migration, not a service-role client call from app code — keeping privilege escalation auditable in SQL (`PT: supabase/migrations/`). Directly relevant to hub's Supabase architecture if we ever add RLS policies.
- **Idempotent kiosk writes + timeout reconciliation** *(new — round 3: [ftc_attendancetracking](sources/ftc_attendancetracking.md), [lab-attendance-kiosk](sources/lab-attendance-kiosk.md))* — every kiosk write carries a client-generated `client_ref`/`client_request_id` deduped server-side, so a retry after a flaky connection never double-writes; lab-attendance-kiosk goes further — if the write to the unreliable downstream (GAS/Sheets) times out, the backend *polls a `request_status` endpoint by request id* to recover the committed result rather than erroring or double-writing. The robust pattern for any kiosk on shop Wi-Fi. No license (ideas only).
- **Offline-first sync queues** *(new — round 3: [rev_parts_tracker](sources/rev_parts_tracker.md), [second](sources/second.md))* — rev_parts_tracker writes every checkout to Dexie/IndexedDB first and a background `syncPendingTransactions()` replays with retry counting + client-generated txn IDs (no dup on retry); second uses an **adaptive sync cadence** — push/pull intervals shrink to ~60s after any clock event then decay to a slow idle poll, cutting API calls without websockets. Both stronger than AT's kiosk cache. No license / GPL-3.0 (ideas only).
- **Remote kiosk-fleet management** *(new — round 3: [frc-attendance-system / RoboLancers](sources/frc-attendance-system.md))* — mentors push remote commands (restart-display/services/reboot) to a *named* kiosk via a polled command queue, and a kiosk heartbeat/health table drives an on-device state machine — fleet management beyond AT's single-kiosk resilience. No license.
- **Reflection-driven auto-form generation** *(new — round 3: [roboparts](sources/roboparts.md))* — walks a Go struct via reflection, mapping field kind → HTML input (bool→checkbox, numeric→number, struct→recurse) and honoring `ui:"-"`/`ui:"textarea"` tags, so new model fields get create/list forms with no templates. Reusable for any admin CRUD surface. No license (ideas only).
- **Enum→lookup-table & two-phase soft-delete migration playbooks** *(new — round 3: [workorder](sources/workorder.md))* — (1) migrate a hardcoded enum to an admin-editable guild-scoped lookup table (seed per tenant, backfill by name, orphan fallback row, then NOT NULL + drop old column); (2) two-phase soft-delete with a live-countdown recovery window, hard-deleted by Supabase `pg_cron` after grace. Directly reusable for hub's status/category enums and any bulk-clear-with-undo. MIT.
- **No-login shareable "magic-code" portal** *(new — round 3: [floorrunner](sources/floorrunner.md))* — a per-external-party link (no account) exposes a scoped read-only view via a token row + RLS — the per-party analogue of Den's anonymous guest mode (parents/sponsors/customers). **Caution:** the repo's "hash" is plain `btoa()`; a reimplementation must use a random token + HMAC/SHA-256. Also a simpler plain-RLS multi-tenant angle (`shop_id` vs `auth.uid()`) than PT's security-definer RPCs. No license.
- **Transparent backend-swap demo mode** *(new — round 3: [robotics-command-center](sources/robotics-command-center.md))* — one generic CRUD client switches between real Firestore and a localStorage clone of the identical interface by env config, so the UI never branches — a fully-functional offline/trial mode distinct from a read-only guest. No license.
- **Filesystem-convention plugin auto-discovery** *(new — round 3: [frc-slack-bot / 1721](sources/frc-slack-bot.md))* — dropping a file in `plugins/` auto-registers it as a bot command (by filename/config name) with shared `<required>`/`[optional]` syntax validation and an auto `!help`. Reusable for any bot or admin-command surface. MIT.

## 8. Design → Manufacturing (Onshape/CAD workflow) — new section this round

v1 had almost nothing here beyond CP's status pipeline; this round found six tools whose whole
purpose is bridging CAD to the shop floor (HS, KS, FB, OMP, PC, PT — plus FB↔FO integration).
Hub's team uses Onshape, so this is the highest-signal new domain. All entries have empty
Decisions.

### 8.1 Onshape BOM import & live sync
- **FB** — the high-water mark: linking a system to an Onshape assembly registers a **webhook**; every CAD save pushes a re-sync (~1s claimed), pulling name/description/quantity/material/process custom properties, thumbnails, and last-edited metadata. Started (2024) as API-keys + a custom FeatureScript teams had to install; rebuilt (2026) as pure OAuth + native custom properties — a documented lesson that "don't make the CAD team install your plugin" wins.
- **PT** — pull-based with **human-reviewed diffs**: `sync-diff` fetches the live BOM, stages an added/removed/changed diff in a table, and `sync-apply` commits it after review; manual quantity edits can be locked against re-import overwrites (`PT: src/app/api/onshape/{sync-diff,sync-apply}/route.ts`, `bom_items.quantity_locked`).
- **KS** — webhook-driven like FB (registered per document, tracked in an `active_webhooks` collection) with an Onshape API response cache (`KS: pb/pb_hooks/onshape/webhooks.js`).
- **[meco-mission-control-platform](sources/meco-mission-control-platform.md)** *(new variant — review)* — the most defensive sync design surveyed: every CAD import (STEP upload or live Onshape) creates an **immutable chained `CadSnapshot`**, and a supersedable `CadMappingRule` engine (stable-signature / instance-path / normalized-name strategies with confidence levels) maps CAD nodes onto team subsystem/mechanism/part targets with per-snapshot propose/confirm/reject — so re-imports *never silently rewrite* past decisions. Plus first-class **Onshape API-cost control**: per-call request logs, immutable-vs-short-TTL response caching, and a daily/monthly/annual call-budget entity with warning/hard-stop thresholds. TS/Fastify/Prisma, no license. *(Also hard-refuses to boot with a STEP-parser placeholder enabled — an anti-footgun.)*
- **[frc-parts / SpikeParts](sources/frc-parts.md)** *(new variant — review)* — imports are **hard-blocked to released Onshape *Versions* only** (workspace refs rejected), forcing the CAD release workflow before a part can enter the tracker; each microversion bump on re-import creates a `partRevision` snapshot and can raise a "design changed" flag. No license (private).
- **[austinbowles29 / 254](sources/austinbowles29-cheesy-parts.md)** *(new variant — review)* — the Onshape-embedded submission panel reads the ~20 query params Onshape passes it (documentId/elementId/partId…), auto-fills metadata via OAuth+API, and **falls back to scanning the containing assembly BOM** for a part-number match (by partId then name) when the direct lookup misses. All-rights-reserved (ideas only).
- *Also seen in round 3:* [cadsense](sources/cadsense.md) (Onshape doc sync + search-index refresh + agent-driven viewport control; MIT), [claude4frc](sources/claude4frc.md) (HMAC-signed direct Onshape API access, no live sync; no license), [7028-parts](sources/7028-parts.md) (Onshape linkage fields present but the import provider stubbed).
- **Decision:**

### 8.2 Release-to-manufacturing kanban (CAD-linked)
- **HS** — browse a live Onshape Part Studio, **release** parts onto a kanban board; a part is only eligible if it has a material and part number set in CAD (the UI explains which check failed); release snapshots the exact Onshape document/element/part/version IDs onto the card; bulk multi-select release (`HS: app/onshape_connector/utils/partEligibility.ts`). The eligibility-gate + coordinate-snapshot pair is the most defensible pattern here.
- **KS** — cards on a parts-type board carry a linked Onshape part with an in-browser **three.js 3D preview**, revision history, and per-board auto part numbers (`KS: sk/src/lib/components/parts/PartPreviewRenderer.svelte`).
- **FB** — Not Started / In Progress / Done / COTS drag-and-drop open to all members, with a 3D viewer where clicking a part highlights it in the model and vice versa.
- **OMP** — a 13-column machine-routing board fed by the Onshape panel (see 8.3), Neon Postgres one-table backend.
- **[deep-blue-parts / 199](sources/deep-blue-parts.md)** *(new variant — review)* — a **"release for manufacture" gate** (blocked unless qty set + drawing uploaded); on success it fans out in one action: a Slack post to #parts-notifications *and* **one Trello fab card per unit of quantity** (each with a 16-item checklist), storing the card URLs back on the part. BSD-2 (but a 254-Cheesy-Parts fork — ideas only).
- **[rhr-mfg / 2713](sources/rhr-mfg.md)** *(new variant — review)* — cards key off a **composite `(partNumber, onshapeVersionId)` identity** rather than raw element/part IDs (handling Onshape workspace/version/microversion across re-releases), and the board syncs live via Supabase Realtime. No license. *(Likely the same tool as HS with more depth.)*
- **[austinbowles29 / 254](sources/austinbowles29-cheesy-parts.md)** *(new variant — review)* — **spare-part requests are cloned** from an existing request into a new queue entry (own qty, linked via `sourceRequestId`), and the request's **category** (Robot/Spares/3DP/Vendor) drives which extra fields surface on the same record (print material/infill vs vendor/lead-time) — one table, category-conditional fields, not separate tables. All-rights-reserved (ideas only).
- **Decision:**

### 8.3 In-CAD panel extension (tool lives inside Onshape)
- **OMP** — an Onshape right-panel iframe reads the student's **live face selection** (bridging Onshape's face/edge IDs to part IDs via a prebuilt `bodydetails` map), auto-detects material from CAD material properties, finish color by color-distance against the team's powder-coat palette, and part type (plate/tube/hex-shaft/round-shaft) from geometry heuristics — then submits a manufacturing card to Slack and/or the board with an attached STEP/DXF export (`OMP: onshape-panel/index.html`).
- **KS** — a document-side kanban tab: every linked Onshape document gets a panel showing its active tasks in place (`KS: sk/src/lib/onshape/onshape_bridge/`).
- **PC** — the wizard embeds in Onshape's right panel with continuous face-selection tracking (`PC: static/source_onshape.js`).
- **FB** — a read-only Onshape side panel for viewing BOM/progress from CAD.
- **[austinbowles29 / 254](sources/austinbowles29-cheesy-parts.md)** *(new variant — review)* — handles Onshape's **replacement-token quirk** (detects and discards the literal unsubstituted `{$partNumber}` when Onshape fails to fill it) and session-storage-caches panel data for 30 min to avoid refetch storms — the real-world robustness details of living inside the Onshape panel. All-rights-reserved (ideas only).
- **Decision:**

### 8.4 CAD file export (STEP/DXF/STL/G-code) from the tracker
- **PT** — server-side Onshape translation-job flow (submit → poll → download) for STEP/STL, including re-signing Onshape's redirect URLs for its blob host (`PT: src/lib/onshape/client.ts`).
- **KS** — DXF/STEP/GLTF/OBJ exports tracked through an `export_queue` collection to completion.
- **HS/OMP** — per-card STEP/PDF/DXF attachments stored locally (HS) or in Vercel Blob (OMP).
- **PC** — goes all the way to **G-code**: auto-detects holes/pockets/perimeter/tube geometry from an Onshape face or uploaded DXF and generates CNC-router toolpaths with holding tabs and per-material feeds/speeds, 3D toolpath preview with a cut scrubber, and Google Drive upload. Multi-tenant via a `PenguinCAM-config.yaml` teams drop in their own Onshape documents; golden-file G-code tests. MIT. Almost certainly consume-not-rebuild (hosted at penguincam.popcornpenguins.com), but its config-file multi-tenancy and safe-test mode (spindle-off, Z+2" dry run) are notable patterns.
- **[aerie-part-management / 3322](sources/aerie-part-management.md)** *(new variant — review)* — server-side **STEP→GLB conversion** (cascadio) feeding an in-browser Three.js viewer, plus **Onshape drawing-sheet→PDF** render/cache via the Onshape translations API — so a machinist gets geometry *and* dimensioned drawings without an Onshape account. Flask, none/ambiguous license.
- **[sidereal-parts / 9501](sources/sidereal-parts.md)** *(new variant — review)* — on-demand **STEP→DXF via replicad/OpenCascade-WASM** (extracts the flat-face outline for laser/CNC-on-plate), with the per-task download format auto-chosen (STL for 3D-print, DXF for laser/CNC) — no hosted CAM service. No license.
- **[deep-blue-parts / 199](sources/deep-blue-parts.md)** *(new variant — review)* — each new drawing upload (PDF drawing, DXF toolpath) **auto-increments a revision letter** (A→B→C) appended to `rev_history` — versioning as a side effect of uploading. BSD-2 (fork, ideas only).
- *Also seen in round 3:* [frc-parts](sources/frc-parts.md) (per-part or per-operation-step file attachments: .gcode/.nc/.dxf/.stl/.step/.pdf).
- **Decision:**

### 8.5 In-house vs COTS auto-classification
- **FB** — first-sync heuristic: part's source document == the system's linked assembly ⇒ In-house, else COTS; admin override survives future syncs. (Replaced an older weaker "no process assigned ⇒ COTS" heuristic — kept only as fallback.)
- **PT** — an explicit `manufactured | off_shelf` type enum set at creation, driving which fields (part number vs vendor/SKU/purchase link) apply.
- Bridges §8 to §3: COTS rows feed the purchasing pipeline (FB → FRC Orders; PT → its vendor orders board).
- **[deep-blue-parts / 199](sources/deep-blue-parts.md)** *(new variant — review)* — a `cots` part type **independent of project numbering**: creating a COTS part pulls from a reusable project-independent `VendorPart` catalog (vendor prefix + SKU as its own numbering) and immediately sets status=ordered / drawing_created, skipping the design & drawing stages entirely. BSD-2 (fork, ideas only).
- *Also seen in round 3:* [sidereal-parts](sources/sidereal-parts.md) (BOM import classifies fabricated/COTS/skip in one batch, like FB/PT), [frc_api](sources/frc_api.md) (a bare `cad_file_url` link field, no versioning — thinner than FB/PT).
- **Decision:**

### 8.6 Designer/Fabricator assignment & "My Parts"
- **FB** — any member can set a Designer, Fabricator, and per-process manufacturer on any in-house part; assignees get a personal "My Parts" panel at the top of any system they're involved in.
- **PT** — per-part `assigned_to` with a dashboard "My Assigned Parts" list; **bulk status update across an assembly's whole subtree** with a shared reason note (`PT: bulkUpdateAssemblyStatus`).
- **KS** — assignment to user/group/anyone/needs-volunteer with a denormalized assignment cache for fast "assigned to me" queries.
- **[aerie-part-management / 3322](sources/aerie-part-management.md)** *(new variant — review)* — **multi-worker attribution history**: `misc_info.handWorkers` keeps every past worker on a part (rather than overwriting on reassignment), feeding a **fractional-point leaderboard** — 1 pt to the current worker, 0.5 pt to each prior worker, −2 pt if "completed incorrectly." None/ambiguous license.
- **[sidereal-parts / 9501](sources/sidereal-parts.md)** *(new variant — review)* — **split machining/post-processing credit**: a part machined by one member is released back to the pool for a different member to post-process (anodize/sandblast), each earning separate points in an immutable per-task-per-reason ledger. No license.
- **Decision:**

### 8.7 Duplicate-part merge by CAD identity
- **PT only** — re-importing a BOM can create duplicate part rows for one physical part (same Onshape element/part ID referenced from multiple contexts); PT detects the collision and offers both an automatic merge checkbox on edit and an explicit merge action that transfers BOM memberships to the surviving row (`PT: mergeWithExistingPart`). FB has an equivalent "merging listings"/Part Groups feature per its docs.
- **Decision:**

### 8.8 AI-assisted CAD review & authoring *(new — round 3: cadsense, claude4frc)*
- **[cadsense](sources/cadsense.md)** — **AI multi-persona CAD design review**: three independent reviewer personas (systems_integration, program_readiness, mechanical_robustness) each critique a synced Onshape assembly plus agent-captured viewport screenshots, then a synthesis pass merges their findings into prioritized action items *while preserving disagreement*, modeled as event-sourced "thread activity" (resumable on crash). TS/Effect monorepo, MIT.
- **[claude4frc](sources/claude4frc.md)** — **LLM/MCP-driven CAD authoring + COTS search-and-insert**: exposes Onshape Part Studio/Assembly read+edit (features, FeatureScript exec, mate/instance inspection) as MCP tools, plus a pre-indexed "MKCad" COTS catalog with scored fuzzy search (exact > prefix > substring) and one-call insert of the top match into a target assembly. Python/MCP, no license (ideas only).
- Both are a distinct capability class from the tracking tools above — the LLM *acts on* the CAD, not just links to it. Almost certainly out of scope for hub v1, but the highest-ceiling ideas in the survey.
- **Decision:**

---

## Stack, cost & hosting

*(Carried from v1 unchanged, then an addendum with this round's evidence.)*

### What the surveyed stacks teach us
- GP (Rails), CH/CP (Sinatra), CM (Go), AT (Python) are all **self-hosted, server-full** designs — always-on processes, some with background threads/daemons. None run on serverless as-is.
- **RAR (React Router 7 + Express + Drizzle + PostgreSQL + Better Auth) is the closest existing attempt to a modern Node stack for exactly our use case** — worth mirroring its choices where they worked (Drizzle migrations, Better Auth, RBAC schema) even though its domain features are unbuilt.
- **Den independently validates the Node choice**: the most feature-complete, actively-used app in the survey is a React SPA + Node/Express API — proof that this stack comfortably carries the whole feature set for a real FRC team.
- No code porting is realistic anyway (Ruby/Go/Python → TS), so stack choice is unconstrained by the sources.

### Requirements the feature catalog implies
1. **Postgres-shaped relational data** (roster, sessions, parts, orders — all heavily relational).
2. **Auth with roles** (email/password + ideally Google OAuth for students).
3. **A kiosk page** that tolerates flaky networks and works on a cheap tablet.
4. **Scheduled jobs** (auto-sign-out sweep, digests) — needs cron support.
5. **Outbound email** (announcements, approvals) — needs an email API; Supabase does not send app email (its built-in email is auth-only).
6. **CSV export** (trivial anywhere).
7. Optional later: SMS (Twilio), Slack webhook, file uploads (receipts, avatars, 3D models → object storage), Google Calendar read (meeting-anchored attendance, as Den does).

### Recommendation: Next.js (or React Router 7) + Vercel + Supabase — your instinct is right, with three additions
| Concern | Choice | Cost (nonprofit/small team) |
|---|---|---|
| App framework | **Next.js on Vercel** (or React Router 7, matching RAR) | Vercel Hobby free tier is fine for a team-sized app; note Hobby is technically for non-commercial use — a non-profit team qualifies in spirit, but Pro is $20/mo if it ever matters |
| Database + auth + storage | **Supabase** (Postgres + Supabase Auth + Storage) | Free tier: 500 MB DB, 50k MAU auth — years of headroom for a team of ~30–100 people |
| ORM/migrations | **Drizzle** (as RAR chose) — plain SQL migrations, type-safe | free |
| Scheduled jobs | **Vercel Cron** (Hobby: daily granularity, limited) or **Supabase pg_cron** (in-DB, any schedule) → use pg_cron for the sign-out sweep | free |
| Outbound email | **Resend** (or Postmark) — required addition; ~free tier 3k emails/mo covers announcements | free–$20/mo |
| Realtime "who's here" board | **Supabase Realtime** (Postgres changes → WebSocket) instead of hand-rolled sockets | included |

Total expected cost: **$0/mo to start**, worst case ~$20–45/mo if the team outgrows free tiers. Custom domain ~$12/yr.

> Free-tier limits and prices above are as-remembered, not freshly verified — confirm current Vercel/Supabase/Resend tiers before committing in the design spec.

A few notes on the stack choice:
- **Next.js** is a great choice for a modern web app, especially with its built-in API routes and server-side rendering.
- **Vercel** is a solid hosting platform that integrates well with Next.js and provides a good developer experience.
- **Supabase** is a powerful backend-as-a-service that provides a modern SQL database, authentication, and storage solutions.
- Instead of Drizzle, let's try and use supabase's built-in ORM and migration tools, unless we find a compelling reason to use Drizzle.
- For both outbound and inbound email, let's hold off on those until later; I'm not sure we'll need them, and they're much more complicated to implement than they first appear.

### v2 addendum — what this round adds to the stack picture
- **frc-part-tracker (PT) is stack-identical to hub** — Next.js 16 + React 19 + Supabase, Server Actions, committed SQL migrations. Its patterns transfer almost verbatim: RLS one-liner policies via `my_team_id()`/`my_role()` security-definer helpers, security-definer RPCs for privileged writes, an `AFTER DELETE` cleanup trigger, and a hand-rolled Onshape HMAC client with the redirect-re-signing fix for binary exports. Also its scars: enum-evolution debris (dead Postgres enum values), duplicated per-action role checks, and project scoping by string-range queries repeated per page instead of one helper. The single most decision-useful source of the round.
- **FRC_Manager (FM) is the Prisma/NextAuth counterfactual** on the same Next.js base — useful for comparing ORM-first (application-enforced tenancy, one missed `where teamId` = data leak) vs Supabase RLS. Its Edge-vs-Node auth-config split for NextAuth v5 + bcrypt is a reusable recipe if we ever leave Supabase Auth.
- **Both PT and FM appear AI-agent-generated in compressed bursts** (19-day / single-squash histories, no tests, agent config files present) — feature-completeness references, not reliability references.
- **The Onshape ecosystem favors OAuth + webhooks over API keys + plugins** (FB's rebuild, KS's per-user tokens) — if hub adds Onshape sync, start there, and consider consuming FRC Orders/FRC BOM/PenguinCAM as hosted services before rebuilding any of them.
- **The purchasing "orders" domain now has a hosted free option** (orders.frctools.com, MIT source) — a build-vs-adopt question §3.5/3.10 decisions should weigh.

### Alternatives (one sentence each)
- **Self-host on a $5–10/mo VPS (Coolify/Dokku) with Docker Postgres** — wins if you want zero vendor coupling and don't mind being the sysadmin; loses on bus-factor (you're the only operator) for a student org.
- **Cloudflare Pages + Workers + D1/Hyperdrive** — cheapest at scale and great cron, but SQLite (D1) is a worse fit for this relational domain and the ecosystem is fiddlier for students to contribute to.
- **Keep AT-style on-prem kiosk box + cloud app hybrid** — only needed if you adopt Wi-Fi presence detection (feature 1.3); the on-site agent can be a Raspberry Pi posting to the cloud API.

### Things that don't port to serverless (plan around them)
- AT's Wi-Fi presence scanning (needs LAN access — on-site agent if wanted).
- CM's inbound SMTP server (use Resend/Postmark inbound webhooks instead, as GP does).
- CH's Twilio webhook works fine as a serverless route.
- New this round: NT's BLE beacons and MD's kiosk hardware are on-site by nature (fine — they're clients, not servers); Den's ICS polling, MD's cron auto-timeout, and FB-style Onshape webhooks all map cleanly to pg_cron/Vercel Cron/route handlers.

---

## Appendix: per-source one-liners

*(v1 entries carried verbatim — except Den, rewritten for the now-located source; new sources appended.)*

- **GatherPack** — the feature superset; steal its domain model (Person/Team tree/Membership, periods+punches, events+checkins) and its feature-toggle discipline. MIT.
- **AdvantageTrack** — the best kiosk UX thinking (presence detection, offline resilience, status lights); Google-Sheets-as-DB is a dead end for us but sheet *export* is a good idea. MIT.
- **RAR tracking** — your own team's scaffold; its stack choices (RR7/Express/Drizzle/Better Auth/RBAC schema) are directly reusable decisions even though features are unbuilt. No license (but it's your team's repo).
- **cheesy-hours** — the deepest attendance *policy* thinking: required vs optional days, excusals, mentor-only sign-out, suspect-session review, semester math. No license — ideas only.
- **cheesy-mail** — permission-gated announcement mail done the hard way; we want the feature via an email API, not an SMTP daemon. No license — ideas only.
- **cheesy-parts** — the whole parts domain: numbering scheme, status pipeline, kanban dashboard, vendor-order auto-grouping, reimbursement tracking. BSD-2.
- **Den (Tiger Dynasty)** — *(upgraded this round: source found at heatonk/TigerDen and verified)* the most complete single-team ops app surveyed; its single-permission-map ACL, HMAC-hashed IDs, ICS-anchored attendance with the midnight backdated sweep, and pure-function Gantt scheduler are all now readable in source. No license — ideas only.
- **Nautilus (2658)** — BLE-beacon attendance with an offline-first mobile client and a registration/verification queue cross-referenced against a pre-loaded directory; full/half meeting pairing. No license — ideas only.
- **Meridian** — the deepest attendance *security/ops* thinking: wallet-pass NFC + TOTP QR with anti-clone HMACs, geofence auto-checkout with grace periods, hour caps with deduped warnings, encrypted PII with HMAC lookup, offline kiosk. No license — ideas only.
- **8793PartBot** — Discord + Google Sheets purchasing with LLM part enrichment and a SKU hallucination guard; the spreadsheet is the admin console. Ambiguous license — treat as none.
- **OptixToolkit** — tools/parts/attendance in one Flutter app: reservation queues, barcode inventory, reimbursements with receipt photos, shipment tracking. MIT, but mid-refactor code quality.
- **RoboRegistry** — outreach-event registrar, not team-internal; QR/PIN check-in, kiosk driver mode, printable sheets, public/private data split. GPL-3.0 — ideas only.
- **vector-8177 / Swartdogs AttendanceTracker** — two minimal kiosk apps (Flutter/Firestore and WinForms/CSV); useful mostly as floor-level contrast plus SD's mentor-PIN unlock idea. Both effectively unlicensed/GPL.
- **yeti-basecamp / procurementbot** — intent only (Next+NestJS dashboard fronting a Discord bot; CAD-aware weight-budget purchasing); zero features to model yet. Revisit later.
- **hawk-shop** — Onshape release-to-kanban done deliberately small (one container, SQLite, SSE); steal its part-eligibility gate and Onshape-coordinate snapshotting. No license — ideas only.
- **kanshape** — the most complete Onshape kanban: custom card fields, group assignment, Gantt with tests, revision history, webhooks, audit diffs, leaderboard — all on PocketBase. MIT (stale attribution).
- **FRCTools Orders** — the modern purchasing pipeline (to_order/ordered/arrived) with URL auto-fill, cross-vendor MeiliSearch catalog, BOM CSV import, Resend notifications; hosted free. MIT — and a consume-don't-rebuild candidate.
- **FRC BOM** — closed-source hosted BOM/manufacturing dashboard with ~1s Onshape webhook sync, In-house/COTS heuristics, Box Mode inventory, FRC Orders integration; observed behavior only.
- **OnshapeManufacturingPipeline (6328)** — the in-CAD submission panel: live face selection → auto-detected material/finish/part-type → Slack cards + board; single-team hardcoded, no board auth. No license — ideas only.
- **PenguinCAM** — Onshape/DXF → CNC G-code with tabs, feeds/speeds, 3D preview; multi-tenant via a YAML config in the team's own Onshape docs; golden-file tests. MIT — consume the hosted instance.
- **frc-part-tracker** — **same stack as hub**; the RLS-helper/security-definer-RPC/Onshape-client patterns transfer directly, and its enum/scoping scars are free lessons. No license — recreate, don't copy.
- **FRC_Manager** — eight-module breadth reference (tools+certs, inventory auto-reorder, purchase approvals with $50 auto-approve, budget, $5k BOM cap, milestone Gantt, safety checklists) on Next+Prisma. Apache-2.0.
- **Dozer** — the Discord-native ops reference: role menus, verification gates, modmail, scheduled sends, TBA lookups — and a demonstration of what a single-team tool should invert (canonical verified roster vs self-reported). GPL-3.0 — ideas only.

---

## What changed since v1

**New sources.** 16 full surveys added (NT, MD, PB, OT, RR, V8, SD, YB, YP, HS, KS, FO, FB, OMP, PC, PT, FM, DZ — of which YB/YP are zero-content placeholders and RR is out-of-rubric but adjacent), plus ~30 long-tail sources triaged into [sources/99-index.md](sources/99-index.md) (one paragraph each: purchasing/inventory, design/manufacturing, bots, integrations, attendance, and 7 Chief Delphi practice threads).

**Upgraded entries.** **Den** is no longer outside-in: the source was located at [heatonk/TigerDen](https://github.com/heatonk/TigerDen), fingerprint-verified against the v1 observations, and [sources/den.md](sources/den.md) was rewritten in place with commit-pinned references. Two discrepancies vs the outside survey: the deploy subdomain has been renamed (`inventory.tigerdynasty.app`), and the current commit's permission map has **no guest-visible actions** (rank 0 → 401 everywhere) — flagged under 2.3 and §7 because the v1 guest-mode decision cited the observed live behavior; the underlying mechanism is confirmed and better than expected.

**New feature entries (empty Decisions to fill in):** 1.11 hour caps, 1.12 check-in anti-cheat, 2.8 multi-team/join codes, 3.10 URL auto-fill & vendor catalog search, 3.11 BOM CSV import, 3.12 $5k BOM cost-cap, 3.13 tool/equipment checkout, 3.14 shipment tracking, 4.7 chat bot as interface, 5.4 safety checklists, and all of **section 8 (Design → Manufacturing: Onshape sync, release-to-kanban, in-CAD panels, CAD export/CAM, COTS classification, part assignment, duplicate merge)**.

**Coverage rebalance achieved.** v1 was attendance-heavy; this round deliberately pushed on the underrepresented areas and found the most: purchasing (FO, PB, FM, FB's Order Mode — plus the discovery that **FRC BOM ↔ FRC Orders are an integrated ecosystem** hub could consume rather than rebuild), and design→manufacturing (six dedicated tools, all Onshape-centric).

**Most decision-useful single finding.** **frc-part-tracker runs hub's exact stack** (Next.js 16 + Supabase); its `my_team_id()`/`my_role()` RLS helpers, security-definer RPC discipline, and Onshape HMAC client are directly transferable patterns, and its migration scars (undropable enum values, repeated scope queries) are free warnings.

**Gaps still uncovered.** No strong source yet for: mailing-list/announcement email at team scale on a modern stack (CM remains the only deep one; FO's Resend usage is transactional-only), parent-facing features (portals, permission slips, forms), fundraising/sponsorship management beyond FM's schema-only `Sponsor` model, travel/logistics planning, and food/meal coordination. Scouting remains deliberately out of scope (NT's scouting module was noted but not cataloged). Two seed repos (yeti-basecamp, yeti-procurementbot) should be re-checked in a future round for real code.

---

## What changed in round 3 (exhaustive sweep)

Round 3 was an exhaustive GitHub + Chief Delphi sweep aiming to record *basically every* FRC (and comparable-org) repo that has already implemented these ideas. It added **~90 new full surveys** on top of the 25 shorthand sources, all catalogued in [03-exhaustive-index.md](03-exhaustive-index.md) (Section A full surveys, B index-only, C deferred, D non-repo/CD threads, E dropped + the one license-excluded repo). Rather than mint ~50 new shorthand codes, round-3 findings are folded **inline** into the existing feature entries: a `*(new variant — review)*` bullet for each genuinely novel mechanism, one compact `*Also seen in round 3:* …` line per feature for me-too reimplementations, and new feature entries where the idea had no home. **Every existing hand-filled Decision was preserved byte-for-byte; new material only appends.**

**New feature entries this round (all with empty Decisions):** 1.13 per-session performance rating, 1.14 per-event check-in survey, 2.9 Youth Protection compliance & escalation, 2.10 membership inactivity auto-deactivation, 3.15 robot weight-budget/125 lb tracking, 3.16 inter-team surplus parts exchange, 3.17 grants & sponsor/donor CRM, 4.8 personal keyword-watch subscriptions, 4.9 local-LLM club-ops assistant, 8.8 AI-assisted CAD review & authoring.

**Highest-signal new mechanisms.** Attendance: OTP-unlock kiosk cookies, R503 fingerprint kiosks, event-sourced attendance logs with derived-view sessions, adaptive-cadence offline sync, and idempotent-write + timeout-reconciliation patterns for flaky shop Wi-Fi (a §7 pattern). Roster/RBAC: a DB-backed `(role, section)` permission matrix over sensitive PII, and single-catalog-drives-schema+validator+nav permission systems. Purchasing: LLM email-to-order extraction, live Hack Club Bank treasury sync, XLSX bank-statement reconciliation, and a two-phase preview/commit BOM import. Design→mfg: heuristic CAD-to-machine auto-routing, immutable CAD snapshots with a supersedable mapping-rule engine + Onshape API-budget control, STEP→GLB/DXF conversion, and released-Version-only import gates.

**New capability classes that didn't exist in v1/round-2.** A Youth-Protection moderation+escalation layer (buildseason), inter-team parts marketplaces (partexchange), grants/sponsor CRM funding pipelines (cacao), and LLM/agent surfaces acting *on* the data — a tool-calling Claude Discord agent (buildseason), a local-Ollama ops assistant (ftc-dashboard), and MCP-driven CAD authoring + multi-persona CAD review (claude4frc, cadsense). These are almost all out of scope for hub v1 but represent the ceiling of what teams are building.

**Fully excluded.** **bc3tech/frc-discord-bot** carries an explicit anti-LLM license clause — no code was analyzed; it is retained only as an exclusion record in the index.

**Confirmed by scale.** Inventory management is the single most-reinvented feature in the entire survey (§3.8 alone gained ~11 distinct round-3 mechanisms), and the modern-stack convergence continues: the newest tools overwhelmingly land on Next.js/React + Supabase/Convex/Firebase — the same neighborhood as hub.
