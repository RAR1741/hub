# Features

Team Hub started as an attendance tool and has grown into a full team-operations hub: attendance,
roster, teams, parts/shop, events, and a handful of external integrations. This page is the
scannable catalog of what's built, grouped by area, with a route per entry. The
[README](../README.md) stays lean and links here; longer behavior write-ups live in
[`docs/features/`](features/), and integration setup steps live in [`docs/setup/`](setup/).

## Auth & sign-in

- **Email OTP sign-in** — primary sign-in method: a 6-digit code emailed via Gmail. `/login`
- **Student ID sign-in** — students without email access sign in by student ID. `/login`
- **Mentor Google OAuth** — mentors sign in with Google; the first Google sign-in bootstraps the
  admin account. `/login`, `/auth/callback`
- **Account request form** — a new student without an account requests one for mentor review.
  `/login` → `/admin/requests`
- **Sign out**

## Roster / people

- **Roster & profiles** — role-scoped roster for mentors+ and public profile pages. `/people`,
  `/people/[id]`
- **People admin** — manage every person, including multiple linked emails per identity and
  setting the primary. `/admin/people`
- **CSV roster import** — bulk create/update the roster from a CSV. `/admin/people/import` — see
  [features/csv-roster-import.md](features/csv-roster-import.md)
- **Find & merge duplicates** — detect and merge duplicate people records. `/admin/people/duplicates`
  — see [features/merge-duplicate-people.md](features/merge-duplicate-people.md)
- **Application import** — bulk-import team applications from a Google Forms CSV export.
  `/admin/application-import`
- **Guardians & sibling links** — link a student to guardian contacts and sibling students. See
  [features/guardians.md](features/guardians.md)
- **Badges & training** — award and track credentials/training completion. `/admin/badges`,
  `/admin/badges/[id]` — see [features/badges.md](features/badges.md)
- **Admin masquerade** — an admin can impersonate another person's view for 1 hour.

## Teams

- **Browse & join teams** — view teams and apply to join. `/teams`
- **Teams admin** — manage teams, including linking a Google Group email. `/admin/teams`,
  `/admin/teams/[id]`

## Attendance / kiosk

- **Kiosk sign-in/out board** — a shared-device board for clocking in/out, with flash messages
  that auto-dismiss after 5s; mentors/admins can act on behalf of anyone even without a registered
  device. `/kiosk`
- **Kiosk device registration** — register a device as a trusted kiosk. `/kiosk/setup`,
  `/admin/kiosk-devices`
- **Who's-here board** — live list of who's currently signed in, on the home page and via API.
  `/`, `/api/whos-here`
- **Sessions admin** — view/edit attendance sessions, review flagged sessions, and a nightly
  auto-close sweep for sessions left open past the day boundary. `/admin/sessions`,
  `/admin/sessions/flagged`
- **Manual excusals** — a mentor/admin can record an excused absence directly.

## Hours, reports & leaderboard

- **Leaderboard** — top 10 students and top 10 mentors by hours; guests see masked names.
  `/leaderboard`
- **Reports (CSV export)** — hours, attendance, and dietary CSV exports for a period. `/admin/reports`
  — see [features/reports-export.md](features/reports-export.md)
- **Time import** — bulk-import attendance from a Google Sheets CSV export. `/admin/time-import`
- **Season hours goal** — an optional season-hours target (`/admin/settings`) that shows a progress
  bar on the home page and `/me/attendance` once set above zero.

## Member self-service

- **My attendance** — a member's own attendance summary, hours-vs-goal progress, a missed-required-
  day nudge, and self-service excusal requests. `/me/attendance` — see
  [features/excusal-requests.md](features/excusal-requests.md)
- **Home dashboard** — who's-here board, personal hours + goal progress, and upcoming meetings with
  Required tags. `/`

## Calendar & meetings

- **Calendar attendance grid** — attendance across build days at a glance. `/calendar`
- **Build days** — mark meeting days required or optional. `/admin/build-days`
- **Meetings** — synced from Google Calendar (hourly, via pg_cron) plus manual entries.
  `/admin/meetings`
- **Periods** — define attendance periods, with a season generator to create a full season's worth
  at once. `/admin/periods`, `/admin/periods/generate`

## Events & forms

- **Member events** — browse and sign up for events, including an inline form when one's attached.
  `/events`
- **Events admin** — manage events, check-ins, manual roster entry, Google Calendar linking, and a
  printable roster. `/admin/events`, `/admin/events/[id]`, `/admin/events/[id]/print`
- **Sign-up forms engine** — build custom forms attached to events. `/admin/forms` — see
  [features/events-and-forms.md](features/events-and-forms.md)

## Parts / shop

- **Shop dashboard** — public live manufacturing status by project. `/shop`, `/shop/[projectId]`
- **Parts & projects admin** — part numbering, assemblies, drawing/approval statuses.
  `/admin/projects`, `/admin/parts/[id]`
- **Onshape panel** — Onshape integration surfaced in-app. `/onshape` — see
  [features/parts-and-shop.md](features/parts-and-shop.md), [setup/onshape.md](setup/onshape.md)
- **Battery tracking** — inventory and per-match usage log replacing paper log sheets. `/batteries`,
  `/batteries/[id]` — see [features/battery-tracking.md](features/battery-tracking.md)

## Admin review & settings

- **Requests queue** — one queue for account requests, team applications, and excusal requests.
  `/admin/requests`
- **Settings** — timezone, calendar ID, auto-close/max-shift hours, season hours goal, and sync
  secrets. `/admin/settings`

## Integrations

- **Slack** — account linking, weekly mentor FIRST reminders, and sync-failure alerts. `/admin/slack` — see [features/slack-integration.md](features/slack-integration.md), [setup/slack.md](setup/slack.md)
- **FIRST roster sync** — syncs roster data from FIRST, with a status dashboard.
  `/admin/first-status` — see [features/first-roster-sync.md](features/first-roster-sync.md)
- **Google Drive group sync** — syncs team membership to Google Groups. `/admin/drive-sync` — see
  [features/drive-group-sync.md](features/drive-group-sync.md),
  [setup/google-drive-groups.md](setup/google-drive-groups.md)
- **GitHub team sync** — syncs team membership to GitHub Teams. `/admin/github-sync` — see
  [features/github-team-sync.md](features/github-team-sync.md),
  [setup/github-app.md](setup/github-app.md)
- **Team external accounts** — role-owned service accounts linked to a team's Google Group or GitHub Team.
  `/admin/teams/[id]` — see [features/team-external-accounts.md](features/team-external-accounts.md)
- **Onshape** — see [features/parts-and-shop.md](features/parts-and-shop.md),
  [setup/onshape.md](setup/onshape.md)
- **Google Calendar sync** — see [setup/google-calendar.md](setup/google-calendar.md)
- **Gmail sending** — currently used only to deliver OTP sign-in codes, not general mail. See
  [setup/gmail-sending.md](setup/gmail-sending.md)

## Ops

- **Nightly DB backup** — scheduled backup to Google Drive via GitHub Actions (not user-facing).
  See [setup/db-backup.md](setup/db-backup.md)

## Cross-cutting

- **Global activity indicator** — a loading/saving/saved pill reflecting in-flight requests.
- **Light/dark theme toggle**

---

The Google Calendar end-to-end (real service account + shared calendar) and the production deploy
itself are user-driven — they need real accounts/credentials that can't be created autonomously.
See [setup/google-calendar.md](setup/google-calendar.md) and [setup/deploy.md](setup/deploy.md).
