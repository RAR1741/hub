# incredibotsftc/teamforge — Source Survey

**Repo:** incredibotsftc/teamforge — https://github.com/incredibotsftc/teamforge
**Surveyed-at:** a615fbe1e2ba2a0234688fe425d08662021a8d4c (get via: gh api repos/incredibotsftc/teamforge/commits --jq '.[0].sha')
**Permalink form:** https://github.com/incredibotsftc/teamforge/blob/a615fbe1e2ba2a0234688fe425d08662021a8d4c/<path>
**Stack:** Next.js 15 (App Router) + TypeScript, Supabase (Postgres + Auth via `@supabase/ssr`), TanStack Query, BlockNote (notebook), Univer (in-app spreadsheets), Mantine + Radix/shadcn UI, react-big-calendar, recharts
**License:** GNU AGPL-3.0 per `LICENSE.md` (full FSF AGPLv3 text, copyright "Team Incredibots (#26336)") — copyleft, ideas only, no code reuse. GitHub's API/UI license field reports `NOASSERTION`/"Other" because the file is named `LICENSE.md` rather than GitHub's recognized `LICENSE`/`LICENSE.txt`, not because the terms are ambiguous — the file content unambiguously states AGPL-3.0. Confirmed by reading the raw file; flag resolved.
**Last activity:** 2025-12-14 (pushed_at)
**FRC team:** Not FRC — this is an FTC (FIRST Tech Challenge) team's tool, explicitly labeled FTC-comparable per task scope. Built by FTC Team Incredibots, #26336.
**Areas:** people/rosters (primary), time/attendance (event RSVP + mentoring session attendance/hours), communication (invite links, calendar/event notices, notification preferences incl. Discord-linked fields), third-party integrations (official FTC Events API). Out of scope and excluded from this survey: the built-in scouting module (robot-performance scouting app) and the Univer-based "sheets"/notebook editors (general docs, not manufacturing/part tracking) — no parts-ordering/PO or part-design/manufacturing-tracking features exist in this repo.

## Purpose
A season-based, multi-tenant SaaS-style web app ("FTC TeamForge") giving an FTC team (and any teams
it mentors) one place to run team operations: roster/role management, a shared calendar with
RSVP, budget/fundraising tracking, kanban tasks, a Notion-like team notebook, and a
scouting/analytics module layered on the official FTC Events API.

## Auth & Roles
- Supabase Auth (email/password) via `@supabase/ssr`, cookie-based session, refreshed in
  `src/middleware.ts` on every request.
- Client components gate routes with `src/components/ProtectedRoute.tsx` /
  `src/components/AuthProvider.tsx`.
- API routes authenticate via Bearer token and a shared `withAuth` / `withAdminAuth` wrapper in
  `src/lib/api-auth.ts`, which resolves the caller's `team_members` row (role) before running
  handler logic — e.g. `src/app/api/team/invites/route.ts` uses `withAdminAuth` to gate invite
  creation/listing to admins.
- Role model: `admin | mentor | student | guest` (also a distinct `parent` value defined at the DB
  enum level, `team_member_role`), enforced both in `team_members.role` / `team_invites.default_role`
  CHECK constraints (`database/migrations/0001_init.sql`) and again in API-layer checks — i.e.
  defense in depth rather than RLS-only (per project's own `CLAUDE.md`-equivalent notes, Postgres
  RLS is largely service-role-gated with app-layer enforcement doing the real authorization work).
- Public, unauthenticated survey-taking (`src/app/s/[surveyId]/page.tsx`,
  `src/app/api/public/surveys/[surveyId]/route.ts`) and public invite validation
  (`src/app/api/team/join/route.ts`, rate-limited) are the two intentionally-open surfaces.

## Data Model
Core tables (from `database/migrations/0001_init.sql`, later migrations add versioning/surveys):
- `teams` — team_number, team_name, school_name, state/country, logo_url.
- `seasons` — start/end year, `is_current_season` flag; almost every other table carries a
  `season_id` FK so the whole app is season-scoped.
- `team_members` — first/last name, email, `role`, `grade` (6–12 CHECK), `subteam`, `is_active`,
  plus `discord_user_id`/`discord_username` (added post-init).
- `team_invites` — `invite_code` (generated via `generate_invite_code()` Postgres function, base64
  + confusable-character substitution), `default_role`, `max_uses`/`current_uses`, `expires_at`.
- `events` + `event_attendees` — event type enum (meeting/competition/outreach/workshop/social/
  review/practice/fundraising/training/scrimmage/other), full recurrence support (daily/weekly/
  monthly/yearly, interval, days-of-week, end date or count, `parent_event_id` for instances),
  attendee `status` enum (pending/attending/not_attending/maybe).
- `mentoring_teams` + `mentoring_sessions` — a mentor team tracks one or more mentored teams;
  sessions log date/start/end time and a JSONB `attendees` array of team_member IDs (hours
  derivable from start/end time), season-scoped.
- `expenses` (category enum: food/events/materials/tools/travel/apparel/marketing/other) and
  `fundraising` (source_type enum, status pipeline: prospecting → pending → committed → received/
  declined/cancelled, amount_requested/committed/received).
- `tasks` — status enum (todo/in_progress/done), category enum (outreach/mentoring/fundraising/
  robot_building/programming/documentation), multi-assignee via `assignee_ids uuid[]`.
- `notebook_folders` / `notebook_pages` — BlockNote JSON content, `linked_entity_type` CHECK
  restricting links to `mentoring_session | event | task | scouting_team`.
- `ftc_teams_cache` — cache of the public FTC Events API team directory (team_number+season PK).
- `team_notes`, `team_images`, `user_settings` (theme, accent color, notification prefs including
  `discord_notifications`/`push_notifications`/`push_subscription`).
- Later migrations (`0002`–`0005`) add app-version tracking and a full survey subsystem
  (survey_templates, surveys, survey_questions, survey_responses — out of the six scoped areas,
  not detailed further here).

## Features

### People / rosters
- Team roster with role, grade, subteam, active flag — `src/components/AddMemberForm.tsx`,
  `src/app/team/page.tsx`, `database/migrations/0001_init.sql` (`team_members`).
- Role-based permission enforcement (admin/mentor/student/guest) at both DB CHECK and API layer —
  `src/lib/api-auth.ts`, `src/app/api/team/invites/route.ts`.
- Shareable invite-link system with configurable default role, max uses, and expiry, plus
  anonymous invite validation and self-join — `src/app/api/team/invites/route.ts`,
  `src/app/api/team/join/route.ts`, `src/app/join/page.tsx`, `src/components/CreateInviteButton.tsx`,
  `src/components/InvitesManagement.tsx`.
- Multi-season support with season switching and a first-run/season-setup wizard —
  `src/components/SeasonsManagement.tsx`, `src/components/SeasonSetupStep.tsx`,
  `src/components/FirstRunExperience.tsx`.
- Mentored-team roster: a mentor team manages a list of teams it mentors (school, mentor,
  "mentoring since" year) — `src/app/mentoring/page.tsx`, `src/app/mentoring/[teamId]/page.tsx`,
  `src/app/mentoring/AddTeamSheet.tsx`, `mentoring_teams` table.
- Team settings (name/logo/location) — `src/components/TeamSettings.tsx`,
  `src/components/TeamSetupForm.tsx`.

### Time / attendance
- Event RSVP/attendance tracking with a 4-state response (pending/attending/not_attending/maybe)
  per member per event — `event_attendees` table, `src/components/calendar/EventDetailsModal.tsx`,
  `src/app/api/events/[eventId]/route.ts`.
- Recurring events (daily/weekly/monthly/yearly, custom interval, day-of-week selection, end-date
  or occurrence-count termination) — `events` table CHECK constraints,
  `src/components/calendar/EventFormContent.tsx`.
- Mentoring-session time logging: date, start/end time, JSONB attendee list, aggregated into
  monthly mentoring-hours analytics — `mentoring_sessions` table,
  `src/components/dashboard/MentoringHoursChart.tsx`, `src/hooks/useDashboardStats.ts`.
- Dashboard "tasks due soon" / "upcoming events" widgets pull from the same date-scoped queries —
  `src/lib/dashboard.ts`, `src/components/dashboard/TasksDueSoonList.tsx`,
  `src/components/dashboard/UpcomingEventsList.tsx`.

### Communication
- Notification preference center: email, Discord, and web-push toggles plus granular
  event-reminder/notebook-mention/weekly-digest flags, and a stored `push_subscription` payload for
  Web Push — `user_settings` table, `src/components/ThemeSettings.tsx` (settings page),
  `src/app/api/user-settings/route.ts`.
- Discord account linking fields (`discord_user_id`, `discord_username`) on `team_members`, with a
  self-service schema-migration check endpoint — `src/app/api/migrate-discord/route.ts` — though no
  outbound Discord webhook/bot code exists in this snapshot (fields are provisioned, sending logic
  is not yet built).
- Invite-link distribution is the primary "bring people in" communication channel (see People
  above); calendar events double as team-wide announcements with location/description fields.
- Public survey links (`src/app/s/[surveyId]/page.tsx`) let the team collect responses from anyone
  with the URL, no login required.

### Third-party integrations
- Official FIRST Tech Challenge Events API client: HTTP Basic Auth
  (`FTC_API_USERNAME`/`FTC_API_KEY`), team lookup, event search, match history, awards, with an
  in-memory 1-hour cache and a Postgres cache table (`ftc_teams_cache`) to survive cold starts —
  `src/lib/ftcEventsService.ts`, `src/app/api/scouting/search/route.ts`,
  `src/app/api/scouting/team-awards/route.ts`, `src/app/api/scouting/team-matches/route.ts`. (This
  powers the scouting module, which is otherwise out of this survey's scope.)
- Supabase used both as auth provider and Postgres/storage backend throughout.

### Not present in this repo (relevant scoped areas with no coverage)
- Parts ordering / purchase orders: none. `expenses`/`fundraising` cover general team finance, not
  a vendor PO/ordering workflow.
- Part design / manufacturing tracking: none. The "notebook" is a general BlockNote-based
  documentation tool (linkable to mentoring sessions/events/tasks/scouting teams), not a
  CAD/part/build-tracking system.

## Integrations
FTC Events API (official FIRST API) for team/event/match/award data. Supabase (Auth + Postgres +
Storage) as the backend-as-a-service. Web Push (browser push subscriptions stored, no server-side
send code found in this tree). Discord account-linking fields exist but no bot/webhook send path
is implemented yet. No email (nodemailer type defs are a declared dependency but no usage found in
`src/`), Slack, SMS, or CRM integrations.

## Notable Implementation Details
- Every domain table carries `season_id`, making season rollover a first-class concept rather than
  a bolted-on filter — worth copying for any FTC/FRC tool that spans multi-year team history.
- Invite codes are generated server-side via a Postgres function (`generate_invite_code()`) using
  `gen_random_bytes` + a confusable-character translation table (`0O1Il+/` → safer chars) so codes
  read unambiguously out loud/on paper — a nice small pattern for any shareable-code feature.
  There's a same-repo `attendance-app` naming coincidence worth noting: this is NOT that other
  small "attendance-app" repo previously surveyed — different org, different scope.
- API auth is centralized in one `withAuth`/`withAdminAuth` wrapper (`src/lib/api-auth.ts`) instead
  of being duplicated per-route — the whole API surface (dozens of route.ts files) funnels through
  it, reducing the chance of an unauthenticated route slipping through.
- Rate limiting is a simple in-memory sliding-window limiter (`src/lib/rateLimit.ts`) explicitly
  documented as per-instance/non-durable in serverless, with inline instructions for swapping to
  Upstash Redis later — a reasonable "good enough for a small team app" tradeoff, not production-
  grade for a multi-instance deployment.
- Recurring events are materialized with constraint-level validation (must have either an end date
  or a count, interval must be positive) rather than left to app-code discipline — DB CHECK
  constraints do real work here.
- The project's own README states it was "developed 100% using AI-assisted programming," which
  tracks with the very uniform, heavily-commented SQL and route structure throughout.

## Verdict
Substantive and directly relevant: a real, actively-developed (Dec 2025) FTC team-ops platform with
clean role-gated roster/invite management, solid recurring-event + RSVP attendance modeling, and a
useful mentoring-hours time-tracking pattern (JSONB attendee list + start/end time). License is
AGPL-3.0 (confirmed from `LICENSE.md`, despite GitHub's NOASSERTION metadata) — copyleft, so treat
as ideas-only. Worth stealing conceptually: the season-scoped schema design, the confusable-safe
invite-code generator, and the centralized `withAuth`/`withAdminAuth` API wrapper pattern. No
parts-ordering or manufacturing-tracking features exist here to draw from.
