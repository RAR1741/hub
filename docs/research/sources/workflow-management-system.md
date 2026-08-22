# Ultronic Team Manager (workflow-management-system) — Source Survey

**Repo:** Ultronic-FTC/Workflow-Management-System — https://github.com/Ultronic-FTC/Workflow-Management-System
**Surveyed-at:** 90cd16090f00132599987ed23a16c1b65dae3463 (get via: gh api repos/Ultronic-FTC/Workflow-Management-System/commits --jq '.[0].sha')
**Permalink form:** https://github.com/Ultronic-FTC/Workflow-Management-System/blob/90cd16090f00132599987ed23a16c1b65dae3463/<path>
**Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres via `@supabase/supabase-js` admin/service-role client), CSS Modules, deployed on Vercel
**License:** none — no LICENSE file present, `license` field is `null` in the GitHub API response (all rights reserved) — ideas only
**Last activity:** 2026-08-20 (pushed_at)
**FRC team:** unknown (org name "Ultronic-FTC" and app branding "Ultronic" suggest an FTC team called Ultronic; no team number found in the surveyed files) — **note: despite the org name, this is an FTC (not FRC) team's tool; comparable and in-scope per task instructions**
**Areas:** (2) people/rosters, (4) communication (Discord notifications), (6) part design/manufacturing tracking is NOT present — this is closer to general task/project/capacity workflow tracking, not part fabrication tracking specifically. No time/attendance (clock-in) system, no parts ordering/PO system, no third-party integration besides Discord webhooks.

## Purpose
A shared, single-workspace task/project/capacity management tool for an FTC team: track tasks through a lifecycle (backlog → assigned → in progress → blocked → completed/review), assign people, log actual hours worked, plan weekly capacity per person, and report on operational vs. technical hours and project "impact" (people reached) over a season.

## Auth & Roles
- **No per-user accounts.** A single shared `TEAM_ACCESS_CODE` (env var) gates the whole app behind `/access` (`app/access/page.tsx`) — everyone enters the same code, which is checked server-side and stored as a SHA-256 hash in an httpOnly cookie (`lib/access.ts`, `lib/team-access-server.ts`, `app/api/access/route.ts`). No expiring session/JWT; cookie lives 30 days.
- **"Working as" identity** is a client-side convenience, not authentication: `components/current-user-provider.tsx` fetches the roster and lets the user pick "yourself" from a dropdown (`components/profile-switcher.tsx`), persisted in `localStorage`. The chosen `member_id` (`actor_member_id`) is sent with every mutating API call so the server can attribute actions and evaluate role permissions — but nothing cryptographically ties the browser to that member, i.e. anyone with the shared code can act as anyone on the roster.
- **Role model:** `student | captain | mentor | coach` (`lib/team-members.ts`). Reviewer/privileged actions (deleting a task or project, changing the competition date, editing "people impacted") require the actor's role to be in `{captain, mentor, coach}`, enforced per-route in the API handlers (e.g. `app/api/tasks/[id]/route.ts` DELETE, `app/api/projects/route.ts` DELETE/PATCH, `app/api/settings/competition-date/route.ts`).
- All API routes call `hasTeamAccess()` first; all Supabase access goes through a server-only admin/service-role client (`lib/supabase/admin.ts`), never exposed to the browser.

## Data Model
Inferred from query shapes (only two migrations are committed: `0000_placeholder.sql` and `003_capacity_planning.sql` — the core schema was evidently created directly in Supabase and isn't fully version-controlled in this repo):
- `team_members` — id, name, role, division (`technical|operational|both`), sort_order, active
- `projects` — id, name, description, division, status (`planning|active|paused|completed|archived`), lead_member_id, target_date, created_by_member_id
- `categories` — id, name, division, sort_order, active
- `tasks` — id, project_id, category_id, title, description, status (`backlog|needs_assignment|assigned|in_progress|blocked|completed`), priority (`low|normal|high|critical`), difficulty (1-5), people_needed, estimated_minutes, deadline, lead_member_id, poc_member_id, blocked_reason, evidence_required/evidence_type/evidence_location, submitted_for_review_at, completed_at, approved_by_member_id/approved_at, review_notes, position, created_by_member_id
- `task_assignments` — task_id, member_id, assignment_source (`self|assigned`), assigned_by_member_id, assigned_at
- `subtasks` — id, task_id, title, assigned_member_id, estimated_minutes, completed, completed_at, sort_order
- `time_entries` — id, task_id, member_id, work_date, minutes, note (actual hours logged against a task)
- `task_activity` — id, task_id, actor_member_id, action, details (JSON), created_at (audit/activity log per task)
- `weekly_capacity` — member_id, week_start (Monday-only, enforced via `isodow=1` CHECK), available_minutes (0–10080), note (`supabase/migrations/003_capacity_planning.sql`)
- `task_weekly_plans` — task_id, member_id, week_start, planned_minutes, FK'd to `(task_id, member_id)` in `task_assignments`
- `historical_work_log` — member_id, work_date, category_name, project_name, task_name, work_type, description, minutes (imported legacy spreadsheet data, matched to live projects/categories by name)
- `project_impact` — impact_year, project_id, project_name, impact_month (nullable = "one-time"), people_impacted
- `team_settings` — singleton row (`id='default'`) holding `next_competition_date`
- A Postgres RPC `delete_task_permanently` handles cascading task deletion server-side.

## Features

### Tasks / workflow (core)
- Kanban-style team board with full CRUD (`app/api/tasks/route.ts`, `app/team-board.module.css`, `app/page.tsx`) — tasks carry project, category, priority, difficulty, people_needed, estimated time, deadline, lead + point-of-contact + multi-assignee.
- Task lifecycle state machine enforced server-side per action (`app/api/tasks/[id]/route.ts`): `update_task`, `self_assign` (join a task if slots remain), `start_work`, `block` (requires a reason), `resume_work`, `complete` (blocked if evidence is required but not yet attached), plus subtask CRUD (`add_subtask`, `toggle_subtask`, `delete_subtask`) and time-entry CRUD (`log_time_batch`, `log_time` legacy, `update_time_entry`, `delete_time_entry`).
- "Evidence required" workflow: a task can require an evidence type/location before it can be marked complete — a lightweight review/proof gate (`app/api/tasks/[id]/route.ts` `evidence_required`/`evidence_location` checks).
- Full per-task activity/audit trail (`task_activity`) — every state change is recorded with actor and JSON details, surfaced in the task detail modal (`components/task-detail-modal.tsx`).
- Task deletion restricted to captain/mentor/coach and routed through a Postgres RPC for safe cascading delete.
- Capacity-aware staffing: `people_needed` vs. actual assignee count is validated on both create and update.

### Projects
- Project CRUD with division (`technical|operational|both`), status, lead, target date (`app/api/projects/route.ts`).
- Deletion blocked if the project still has live tasks (returns a 409 with the task count).
- Progress rollups (task_count, completed_count, blocked_count, progress %) computed per project, including a special "historical_only" mode that surfaces legacy spreadsheet-only completed projects with no live tasks.

### Capacity planning
- Weekly per-person capacity (available minutes/hours) vs. planned minutes per assigned task, with over/under-capacity flags and workload % (`app/api/capacity/route.ts`, `app/capacity/page.tsx`).
- 3-week-forward capacity forecast across all active tasks, bucketed by deadline week including an "unscheduled" bucket and an "overdue-carried-forward" rule (`app/api/capacity/forward/route.ts`).
- Capacity note field per person/week for context.

### Reporting
- Annual reports pivoting hours by person and by project, split into Operations vs. Technical divisions, blending live `time_entries` with imported `historical_work_log` rows matched by normalized project/category name, with a keyword-based division-inference fallback when historical categories don't map cleanly (`app/api/reports/route.ts`).
- "People impacted" tracking per operations project per month or as a one-time value, aggregated into an impact matrix cross-referenced against months where actual task/activity work occurred (`app/api/reports/impact/route.ts`).
- Per-person detail report (`app/api/reports/person-detail/route.ts`) and an "impact" summary endpoint.
- Historical work log browsing and summary stats (activity count, row count, total hours) for imported legacy data (`app/api/historical-work/route.ts`, `app/api/historical-work/summary/route.ts`).
- CSV exports: full roster export (`app/api/export/roster/route.ts`) and a combined work-log export blending live time entries + historical rows with UTF-8 BOM for Excel compatibility (`app/api/export/work-log/route.ts`).

### Operational calendar
- Calendar view of tasks by date; per `INSTRUCTIONS.md` (Build 3A), completed tasks are placed on the date of their **last actual logged work** (`time_entries.work_date`), not their deadline, falling back to deadline only if no time was logged — a deliberate real-vs-planned distinction (`app/operational-calendar/page.tsx`, `app/api/tasks/route.ts`).

### Ideas & Decisions
- A dedicated page (`app/ideas-decisions/page.tsx`) — present in the file tree but not inspected in depth; likely a lightweight idea-tracking/decision-log feature adjacent to task management.

### Communication / notifications
- Discord webhook notifications on key task events — created, assignment changed, self-assigned, started, blocked, resumed, completed (`lib/notifications/discord.ts`, wired into `app/api/tasks/route.ts` and `app/api/tasks/[id]/route.ts`), with color-coded embeds and a `/api/notifications/test` endpoint to verify webhook configuration.

### Settings
- Single shared "next competition date" setting, editable only by captain/mentor/coach (`app/api/settings/competition-date/route.ts`), presumably drives calendar/countdown UI.

## Integrations
- **Discord** — outgoing webhook notifications only (no bot, no incoming commands); URL configured via `DISCORD_WEBHOOK_URL` env var, gracefully no-ops with a console warning if unset.
- **Supabase** — used purely as a hosted Postgres + admin client, not for its auth (the app rolls its own single-shared-code auth) or storage.
- No Slack/email/SMS/Onshape/TBA integration found.

## Notable Implementation Details
- **Server-only admin Supabase client** (`lib/supabase/admin.ts`) is used for every DB call, even reads — there's no RLS-policy-based access control; all authorization is done in API route code. Straightforward and easy to audit, but every new route must remember to check `hasTeamAccess()` and role gates manually (no shared middleware layer visible for that — it's copy-pasted at the top of each handler).
- **Historical data reconciliation**: legacy hours are matched to live `projects`/`categories` by lower-cased/trimmed name equality, with a keyword-based heuristic fallback (`fallbackDivision()` in `app/api/reports/route.ts`) to guess technical vs. operational division for old spreadsheet rows that don't map to a modern category — a pragmatic, if fragile, "migrate messy history into a clean schema" pattern worth reusing conceptually for any team importing old spreadsheets.
- **"Actual completion date"** for the calendar (latest `time_entries.work_date`, not deadline) is a nice conceptually-simple idea for anti-gaming reporting — it reflects when work really happened rather than when a deadline was set.
- **Cross-table pagination helper** (`fetchAll` with 1000-row pages via Supabase `.range()`) is duplicated in both `app/api/reports/route.ts` and `app/api/export/work-log/route.ts` — reusable-utility candidate that wasn't factored out.
- **Weak identity model**: the "Working as" mechanism is purely a client localStorage convenience passed as a plain `actor_member_id` string in request bodies — trivially spoofable by anyone who has the shared team access code (which by design is everyone on the team). Fine for a trusted small team, not a security boundary. A re-implementer wanting real auditability would need per-user auth.
- Committed migrations are incomplete (only a placeholder + one capacity-planning migration exist even though most tables like `tasks`, `projects`, `team_members` are actively queried) — the bulk of the schema was likely applied ad hoc via Supabase Studio and never captured as SQL, a gotcha to watch for if trying to reconstruct the schema faithfully.

## Verdict
Substantive and directly relevant: a compact, real, in-production (Vercel-deployed) FTC task/capacity/reporting system with a clean task-lifecycle state machine, weekly capacity planning, Discord notifications, and a thoughtful "actual work date" reporting nuance. No LICENSE file, so treat as ideas-only. Worth stealing: the task lifecycle+evidence-gate pattern, the weekly-capacity vs. planned-minutes model, the "last logged work date" calendar rule, and the historical-spreadsheet-reconciliation approach for onboarding legacy team data.
