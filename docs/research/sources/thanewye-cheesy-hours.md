# cheesy-hours (thanewye fork) — Source Survey

**Repo:** thanewye/cheesy-hours — https://github.com/thanewye/cheesy-hours
**Surveyed-at:** 437ae025490f471dd0c0e9eea49f29377fa2562d
**Permalink form:** https://github.com/thanewye/cheesy-hours/blob/437ae025490f471dd0c0e9eea49f29377fa2562d/<path>
**Stack:** Ruby (Sinatra, modular `Sinatra::Base`) + Sequel ORM over MySQL, ERB views, vendored Bootstrap 2.x/jQuery 1.10.1, Thin server daemonized via Daemons
**License:** none visible — no LICENSE file in this fork (`gh api repos/thanewye/cheesy-hours/contents/LICENSE` → 404) and `gh api repos/.../thanewye/cheesy-hours --jq .license` returns null. Every source file still carries `# Copyright 2013/2021 Team 254. All Rights Reserved.` headers, unmodified from upstream. Flagged as ambiguous per task instructions: the upstream Team254/cheesy-hours repo is itself unlicensed ("all rights reserved"), and this fork carries the same headers forward without adding any license grant of its own — treat as **ideas only, all rights reserved**.
**Last activity:** 2026-08-18 (commit `437ae02`, `pushed_at` 2026-08-19T04:48:41Z)
**FRC team:** Team 254 (Bellarmine Robotics Lab) — all code, copyright headers, and domain assumptions (student IDs, `members.team254.com` SSO, `media.team254.com` assets) are Team 254's; `thanewye` is a personal GitHub fork, not a distinct team's rewrite.
**Areas:** time/attendance (primary), people/rosters (student/mentor directory, secondary)

## Purpose

Cheesy Hours is a project-hour and attendance tracking web app: students sign in at a lab-door kiosk with their student ID but cannot sign themselves out — a mentor must sign them out via the web UI or by texting the student's ID to a Twilio number. On top of that sign-in/sign-out ledger it computes total "project hours," a public leaderboard, and a per-build-day attendance calendar distinguishing required vs. optional build days and tracking excused absences.

This fork is code-identical to upstream Team254/cheesy-hours in almost every file inspected (`hours_server.rb`, `models/`, `queries.rb`, `views/`), with one functional addition: a second, more permissive local-auth bypass (`DISABLE_AUTH=1`) layered in front of the existing `HOURS_BYPASS_AUTH=1` bypass (see Auth & Roles). No other divergence was found in the files read.

## Auth & Roles

Delegates authentication to Team 254's custom SSO via the `cheesy-common` gem. A Sinatra `before` filter in `hours_server.rb` calls `CheesyCommon::Auth.get_user(request)`; an unauthenticated request to any path other than `/`, `/sms`, `/signin_internal`, or `/signout_automatic` is redirected to `CheesyCommon::Config.members_url?site=hours&path=<path>`. Session state is a `Rack::Session::Cookie` with a 3600-second expiry; `/logout` clears it and redirects to the SSO logout endpoint.

Two local-dev bypasses exist (fork-specific ordering, `hours_server.rb`):
- `DISABLE_AUTH=1` — checked first; injects a plain `DevUser` struct whose `has_permission?` always returns `true` for every permission, no `cheesy-common` involvement at all.
- `HOURS_BYPASS_AUTH=1` — falls back to constructing a real `CheesyCommon::User` with a fixed permission list (`HOURS_SIGN_IN`, `HOURS_EDIT`, `HOURS_DELETE`, `HOURS_VIEW_REPORT`, `DATABASE_ADMIN`).
Both accept `HOURS_BYPASS_BCP_ID` (default `900001`) to choose the impersonated student ID.

Authorization is permission-string based, checked inline per route via `@user.has_permission?(...)`:
- `HOURS_SIGN_IN` — kiosk sign-in (`POST /signin`).
- `HOURS_EDIT` — the bulk of admin actions: sign-out, session CRUD, excusals, build-day scheduling, mentor CRUD, mentor check-ins, calendar, search, suspect-session review.
- `HOURS_DELETE` — delete lab sessions.
- `HOURS_VIEW_REPORT` — CSV exports.
- `DATABASE_ADMIN` — roster resync, hours reset, deleting an entire build day.
- `EVENTS_SIGNUP_EVENT` — not checked by this app for access; it's the permission filtered on when pulling the student roster from SSO.

## Data Model

- **Student** (`models/student.rb`, `db/migrations/001_create_students.rb`) — PK is the school's six-digit student ID (unrestricted, not auto-assigned); `first_name`, `last_name`. `has_many` lab_sessions, excused_sessions. `project_hours`, `week_hours(week)`, `total_sessions_attended` computed in Ruby over the association.
- **LabSession** (`models/lab_session.rb`, migrations 002/004/005/007) — `student_id`, `time_in`, `time_out` (nil = open session), `mentor_id`, `mentor_name` (free-text fallback), `notes`, `excluded_from_total`. `belongs_to` student and mentor; `duration_hours` derived.
- **Mentor** (`models/mentor.rb`, migration 003) — `first_name`, `last_name`, `phone_number` (SMS sign-out whitelist). `has_many` lab_sessions.
- **MentorCheckin** (`models/mentor_checkin.rb`, migration 006) — `mentor_id`, `time_in`; contact-tracing check-in log.
- **OptionalBuild** (`models/optional_build.rb`, migration 008) — unique `date` flagging a day optional; auto-created on sign-in for non-required weekdays.
- **ScheduledBuildDay** (`models/scheduled_build_day.rb`, migration 010) — unique `date` + `optional`; explicit override with highest precedence.
- **ExcusedSession** (`models/excused_session.rb`, migration 009) — `date` + `student_id`, validated non-blank; excuses a required-day absence.

"Build day" is not a stored entity: `queries.rb` derives the set as the UNION of distinct sign-in dates, optional-build dates, and scheduled-build-day dates, then resolves required/optional via a precedence CASE (`scheduled_build_days` → `optional_builds` → `REQUIRED_BUILD_DAYS` weekday list → optional).

## Features

**Time/attendance**
- Kiosk sign-in with duplicate-open-session and IP-whitelist checks — `hours_server.rb` (`get "/"`, `post "/signin"`), `views/index.erb`, `config.json` (`signin_ip_whitelist`).
- Internal sign-in API (`POST /signin_internal`), unauthenticated, meant for localhost-only callers — `hours_server.rb`.
- Live "currently signed in" board, polled every 120s, permission-gated detail (names, sign-out/delete buttons) — `hours_server.rb` (`get "/lab_sessions/open"`), `views/signed_in_list.erb`.
- SMS sign-out via Twilio webhook, single or space-separated batch IDs (full 6-digit or last-4-digit) — `hours_server.rb` (`post "/sms"`).
- SMS mass sign-out (`GTFO` closes every open session) and mentor check-in (`HERE` logs a `MentorCheckin`) — `hours_server.rb` (`post "/sms"`).
- One-click web sign-out stamping time and acting mentor — `hours_server.rb` (`get "/lab_sessions/:id/sign_out"`).
- Leaderboard ranked by total project hours with CSV export — `hours_server.rb` (`get "/leader_board"`, `get "/csv_report"`), `views/leader_board.erb`.
- Per-student detail page: full session history, excusals, add-session/add-excusal actions — `hours_server.rb` (`get "/students/:id"`), `views/student.erb`.
- "My Attendance" self-service semester summary (attended/required/rate/unexcused) with date-by-date status — `hours_server.rb` (`get "/my_attendance"`), `queries.rb` (`STUDENT_ATTENDANCE_RANGE_QUERY`).
- Manual lab-session creation and editing (arbitrary time in/out, notes, exclude-from-total flag) — `hours_server.rb` (`get/post "/students/:id/new_lab_session"`, `get/post "/lab_sessions/:id/edit"`), `views/edit_lab_session.erb`.
- Lab session deletion, confirmation-gated — `hours_server.rb` (`get/post "/lab_sessions/:id/delete"`).
- Excuse / unexcuse a student for a date — `hours_server.rb` (`get/post "/students/:id/mark_excused"`, `get/post "/students/:id/excusals/:date/delete"`).
- Attendance calendar grid (students × build days, color-coded present/absent/optional/excused, semester + year pickers, hide-optional filter) — `hours_server.rb` (`get "/calendar"`), `views/calendar.erb`, `queries.rb` (`CALENDAR_BUILD_INFO_RANGE_QUERY`, `CALENDAR_STUDENT_INFO_RANGE_QUERY`).
- Build-day scheduling: schedule as required/optional, mark optional, unmark optional, delete an entire build day (admin) — `hours_server.rb` (`get/post "/schedule_build_day"`, `/schedule_optional`, `/delete_optional/:date`, `/build_days/:date/delete"`).
- Bulk "optionalize past off-days" — `hours_server.rb` (`get/post "/optionalize_past_offdays"`), `queries.rb` (`BUILD_DAYS_QUERY`).
- Suspect-session report (sessions > 18 hours) — `hours_server.rb` (`get "/suspect_lab_sessions"`), `views/suspect_lab_sessions.erb`.
- Date-range session search — `hours_server.rb` (`get/post "/search"`), `views/search.erb`.
- Attendance CSV export with per-student percentage — `hours_server.rb` (`get "/csv_attendance_report"`), `queries.rb` (`CALENDAR_STUDENT_INFO_QUERY`).
- Season hours reset (bulk-delete sessions before a hard-coded cutoff date) — `hours_server.rb` (`get "/reset_hours"`).
- Automatic sign-out sweep, unauthenticated/internal-only, configurable offset — `hours_server.rb` (`get "/signout_automatic"`), `config.json` (`automatic_signout_offset_hours`).

**People/rosters**
- Mentor management: list, add (phone normalized to last 10 digits), delete — `hours_server.rb` (`get "/mentors"`, `post "/mentors"`, `get/post "/mentors/:id/delete"`), `views/mentors.erb`.
- Mentor check-in log with per-row delete — `hours_server.rb` (`get "/mentor_checkins"`, `get/post "/mentor_checkins/:id/delete"`).
- Roster sync from SSO: pulls all users with `EVENTS_SIGNUP_EVENT`, upserts `students`, deletes anyone no longer present — `hours_server.rb` (`get "/reindex_students"`).
- Role-aware navigation exposing admin links only to permitted users — `views/header.erb`.

## Integrations

- **Twilio SMS** — `POST /sms` in `hours_server.rb` is the raw Twilio messaging webhook; replies are hand-built TwiML (`<Response><Sms>…</Sms></Response>`) via the `sms_response` helper, no Twilio SDK or stored credentials.
- **Team 254 SSO** (`cheesy-common` gem, `git://github.com/Team254/cheesy-common.git` per `Gemfile`) — supplies `CheesyCommon::Auth`, `CheesyCommon::Config` (including AES-decrypting `Encrypted:`-prefixed config values), and the roster source of truth.
- Barcode/ID-scanner-friendly kiosk input (autofocus numeric field, immediate submit) — not a software integration but a UX pattern worth reusing, `views/index.erb`.
- CDN assets: Google Fonts, favicons from `media.team254.com` — `views/header.erb`, `public/css/css.css`.
- No email, Slack, Discord, Google Sheets, or calendar-sync integration anywhere in the codebase.

## Notable Implementation Details

- Single-file router (~625 lines), no test directory, no CI, no linter — `hours_server.rb`.
- Raw SQL executed from within ERB views (`views/calendar.erb`, `views/my_attendance.erb` call `DB.fetch` directly and relax `ONLY_FULL_GROUP_BY` at render time).
- Every table reference in `queries.rb` is hard-coded to the `cheesy_frc_hours.` schema prefix — renaming the database in `config.json` alone will not work.
- Build-day required/optional status is derived at query time via a CASE precedence chain, not stored as a single flag; opening the lab on any non-required weekday silently creates a new `optional_builds` row as a side effect of `POST /signin`.
- Attendance math: a required day only counts toward the denominator if the student wasn't excused, or was excused but attended anyway — excusals shrink the denominator rather than counting as an attended day.
- `Student.get_by_id` (`models/student.rb`) tries the full ID as PK, then falls back to `MOD(id, 10000) = <input>` for a last-4-digit shortcut — a full-table function scan and a collision risk for ID schemes where the last four digits aren't unique.
- IP whitelisting for kiosk sign-in trusts `X-Real-IP` verbatim (assumes a trusted reverse proxy sets it); the automatic-signout sweep does the opposite, only accepting requests where that header is *absent* (i.e., not proxied) as its "internal only" check.
- Hours are computed in Ruby by iterating the `lab_sessions` association per student (`eager(:lab_sessions)` blunts N+1 but the leaderboard still sorts all students in memory) rather than in SQL — ties page cost to total historical session volume.
- Hard-coded thresholds: suspect-session cutoff is `duration_hours > 18` in the view; `/reset_hours` embeds a literal `2018-01-06` cutoff date.
- `config.json` is committed with a plaintext dev DB password and an `Encrypted:`-prefixed prod password (decrypted by `cheesy-common`); README explicitly says plaintext is also accepted for prod.
- The fork's added `DISABLE_AUTH=1` bypass is a superset risk on top of upstream's `HOURS_BYPASS_AUTH=1`: it grants a `DevUser` unconditional `true` from `has_permission?` for *any* permission string, with no `cheesy-common` object or permission list involved at all — a re-implementer should not carry this specific escape hatch into a networked or production-adjacent build.

## Verdict

Substantive and directly on-topic for time/attendance: a small, real, still-actively-touched Sinatra/Sequel/MySQL kiosk-plus-SMS attendance system with a genuinely useful required/optional build-day + excusal model and a derived (not stored) build-day calendar worth reproducing conceptually. It is a near-identical fork of Team254/cheesy-hours (already surveyed separately) — the only functional delta found is an additional, more permissive dev-auth bypass — so treat this survey as confirming/superseding-by-recency rather than introducing new prior art; license status is unresolved on both the fork and upstream (no LICENSE file, "All Rights Reserved" headers), so anything reused must be a clean-room re-implementation of the ideas (SMS sign-out via Twilio webhook, derived build-day precedence, last-4-digit ID lookup, excusal-shrinks-denominator attendance math), never the code.
