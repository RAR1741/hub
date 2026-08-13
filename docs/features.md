# Features

Team Hub is **v1 feature-complete**. This is the running catalog of what's built and how the
less-obvious features behave; the [README](../README.md) stays lean and links here.

## What's built — v1 feature-complete

- Roster + teams: role-scoped roster (`/people`) and profiles, teams with join/apply (`/teams`),
  admin pages for people/teams/requests
- Split-audience auth: student ID sign-in and mentor Google OAuth sign-in, with first-Google-sign-in
  bootstrapping the admin account
- Kiosk sign-in/out (`/kiosk`), who's-here board, and a device-registration flow
  (`/admin/kiosk-devices`)
- Attendance periods (`/admin/periods`), hours + leaderboard (`/leaderboard`), per-member hour detail
- Flagged-session review (`/admin/sessions/flagged`) and a nightly auto-close sweep for sessions left
  open past the day boundary
- Google Calendar sync (hourly, via pg_cron/pg_net) with required/optional build days and excusals
- `/calendar` — the attendance grid across build days
- `/me/attendance` — a member's own attendance summary, hours-vs-season-goal progress, a
  missed-required-day nudge with one-click "Request excusal" links, and self-service excusal requests
  (see below)
- `/admin/requests` — mentor+ review queue for account requests, membership applications, and
  student excusal requests
- `/admin/settings` — timezone, calendar ID, auto-close/max-shift hours, season hours goal,
  kiosk-devices link
- A Playwright smoke suite (kiosk round trip, guest read-only, student login, mentor session edit),
  run in CI on every push/PR alongside lint/typecheck/unit tests
- A deploy runbook (`docs/setup/deploy.md`) covering the hosted Supabase project, Vercel, production
  Google OAuth, and the calendar-sync cron

The Google Calendar end-to-end (real service account + shared calendar) and the production deploy
itself are user-driven — they need real accounts/credentials that can't be created autonomously; see
[`docs/setup/google-calendar.md`](setup/google-calendar.md) and [`docs/setup/deploy.md`](setup/deploy.md).

## Self-service excusal requests

A student can ask for an excused absence themselves instead of waiting on a mentor to enter one:

- On `/me/attendance`, the **Request excusal** card lets a signed-in member submit a date (past or
  future) and an optional reason, which `POST`s `/api/excusal-requests`. The request is always
  scoped to the signed-in viewer — there's no way to request on someone else's behalf. A member can
  have at most one *pending* request per date (a `pending`-partial unique index enforces this
  server-side); re-requesting after a decision is allowed. The **My excusal requests** card below it
  lists the member's own requests with a status pill (pending/approved/denied).
- Each row in the **missed required days** nudge (also on `/me/attendance`) links to
  `/me/attendance?date=YYYY-MM-DD`, which prefills the request form with that date — one click from
  "I missed this" to "I've asked for an excusal."
- Mentors and admins review pending requests on `/admin/requests` (`withRole("mentor")`-gated).
  Approving a request creates a real `excusal` row (so attendance math treats it exactly like a
  mentor-entered excusal, with no separate code path); denying just records the decision. Both
  actions go through `POST /api/admin/requests/excusal/[id]` with `{ "action": "approve" | "deny" }`.

## Season hours goal

`/admin/settings` has a **Season hours goal** field (hours; `0` = no goal set). When it's set above
zero, both the dashboard and `/me/attendance` show a progress bar under the member's hours readout —
"*X* of *Y* h · *Z* to go" — using the shared `hoursGoalProgress()` helper
(`src/lib/hours-goal.ts`). With no goal set, those readouts fall back to showing just the raw hours
number, as before.

## CSV roster import

`/admin/people/import` (linked from `/admin/people`) lets an admin bulk create/update the roster
from a CSV. Columns (case-insensitive, any order): `first_name,last_name,email,role,grad_year,
student_id_number`. Only `first_name` and `last_name` are required; a blank `role` defaults to
`student`. Download a starter file from the **Download template** link (`GET
/api/admin/people/import`).

Each row is matched against the existing roster by **email** (exact — email is always stored
lowercased) first, then by **student_id_number**: a match updates that person's name/email/role/
grad-year/student-ID only (their phone, bio, shirt size, dietary notes, display name, and active
flag are left alone); no match creates a new person. `POST /api/admin/people/import` re-parses and
re-validates the raw CSV text server-side — it never trusts the browser's preview — and returns a
per-row summary (`created`/`updated`/`skipped`/`errors`/`results`), turning duplicate-email/
duplicate-student-ID unique-violations into a per-row error instead of a 500. The pure parser
(`parseRosterCsv` in `src/lib/roster-import.ts`) also flags in-file duplicate emails/student IDs as
per-row errors before anything reaches the database.

## Hours & attendance reports (CSV export)

`/admin/reports` (mentor+, also linked from `/admin` and as an **Export CSV** button on
`/leaderboard`) shows, for a selected period: an **hours** table (member, student ID, total hours —
every active person, including those with zero logged sessions) and an **attendance summary**
table (present/excused/absent/required days/percentage, over the period's *required* build days
only). Each table has an **Export CSV** button.

- `GET /api/admin/reports/hours?period=<id>` and `GET /api/admin/reports/attendance?period=<id>`
  are mentor-gated (`withRole("mentor")`) CSV downloads (`Content-Disposition: attachment`);
  `period` defaults to the active period when omitted.
- The pure CSV encoder (`toCsv` — RFC-4180-ish: quotes commas/quotes/newlines, `""`-escapes
  embedded quotes, CRLF lines) and the two report-row builders (`hoursReportCsv`,
  `attendanceSummaryCsv`) live in `src/lib/reports-export.ts`.
- `attendanceSummaryForPeriod` (`src/lib/attendance.ts`) composes the existing
  `attendanceSummary`/`attendanceForDate` math per active person over a period's build days — it
  doesn't change how a day is scored, just fans the same math out roster-wide.
- `hoursReportForPeriod` (`src/lib/reports.ts`) is the hours-table equivalent of
  `periodLeaderboard`, except it includes every active person (zero-hour members included), not
  just people with at least one session row.
