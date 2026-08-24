# Cheesy Action Items — Source Survey

**Repo:** Team254/cheesy-action-items — https://github.com/Team254/cheesy-action-items
**Surveyed-at:** 33400d9429b8961d8cde124ccf3823fc39d16544
**Permalink form:** https://github.com/Team254/cheesy-action-items/blob/33400d9429b8961d8cde124ccf3823fc39d16544/<path>
**Stack:** Ruby (Sinatra) web app, Sequel ORM, MySQL, ERB views, jQuery + Bootstrap 2 + select2/x-editable frontend
**License:** BSD 2-Clause (`COPYING`) — permissive, safe to reference directly, though we still recreate rather than copy
**Last activity:** 2020-01-14 (single squashed/rewritten history — the repo's only commit is dated 2020-01-14; the app itself targets the "2013-2014" season per its description and is effectively archived)
**FRC team:** Team 254 (The Cheesy Poofs)
**Areas:** people/rosters, communication (task assignment & tracking is a people/communication hybrid — no time/attendance, no integrations, no purchasing, no manufacturing tracking)

## Purpose
A minimal internal tool for Team 254's leads and mentors to assign, track, and grade "action items" (to-dos) given to student leaders — due dates, completion status, mentor sign-off, and a lightweight performance score per leader, replacing ad-hoc email/verbal task assignment.

## Auth & Roles
- No local auth of its own — delegates entirely to a shared `cheesy-common` gem (`CheesyCommon::Auth.get_user(request)`) and a team-wide "members" SSO site; unauthenticated requests are redirected to `members_url` with a return path (`action_items_server.rb` `before` filter).
- On first authenticated visit, a local `User` row is created/looked up by the SSO member's `id`, and the member's display name and permission object are attached to the in-memory `@user`.
- Single fine-grained permission checked throughout: `ACTION_ITEMS_EDIT` (mentor-only). Non-mentors can create/view/edit most fields of an action item but cannot set `completion_date` (close an item) or view `/log` (`action_items_server.rb` lines ~70-95, ~145).
- Role model is binary: student leader vs. mentor (permission-gated), no admin tier, no per-item ownership checks beyond that gate.

## Data Model
- `users` (`db/migrations/001_create_users.rb`, `007_add_name_to_users.rb`) — id (shared with SSO member id, `unrestrict_primary_key`), `name`. Originally stored a `wordpress_json` blob (migration 001) which was dropped in favor of a plain `name` column (migration 007) — evidence the auth backend migrated off WordPress-based membership at some point.
- `action_items` (`002_create_action_items.rb`, `005_add_result_to_action_items.rb`, `006_add_created_by_to_action_items.rb`) — `title`, `deliverables` (free text), `start_date`, `due_date`, `completion_date` (nullable), `grade` (float), `mentor` (free-text name, not a FK), `result` (free text, added later), `created_by_user_id` (FK to `users`, added later — earlier action items have no creator on record).
- `action_items_users` (`003_create_link_table.rb`) — many-to-many join table between action items and their assigned leaders (`models/action_item.rb` `many_to_many :users`).
- `action_item_logs` (`004_create_action_item_logs.rb`) — append-only audit trail: `action_item_id`, `user_id` (who made the change), `changed_at`, `old_content`/`new_content` (full JSON snapshots of the action item before/after).

## Features
**People / task assignment:**
- Create a new action item with title, deliverables, due date, mentor, and one or more assigned leaders (comma-separated user IDs from a select2 multi-select) — `views/new_action_item.erb`, `POST /action_items` in `action_items_server.rb`.
- Edit any field inline via jQuery x-editable widgets on the list view, PATCHed through a generic `POST /api/edit` endpoint keyed by `pk`/`name`/`value` — `public/js/js.js`, `action_items_server.rb` `post "/api/edit"`.
- Full edit form and delete confirmation as separate pages — `views/edit_action_item.erb`, `views/delete_action_item.erb`.
- Open vs. completed item views with auto-refreshing partial list (polls every 10s) — `views/open_action_items.erb`, `views/completed_action_items.erb`, `views/action_item_list.erb`.
- Per-leader roll-up view grouping open/completed items by assigned student — `views/by_leader_action_items.erb`, `User#sorted_action_items` in `models/user.rb`.

**Grading / accountability (the standout feature):**
- Automatic numeric grade computed from timeliness at completion time, not just a manual score: `ActionItem#current_grade` in `models/action_item.rb` — items completed 4+ days early score 1.1 (110%, a bonus for finishing well ahead); items completed 0-3 days early scale linearly from 1.0 to 1.1; items completed late decay exponentially by a half-life of one week (`0.5 ** (days_late / 7)`), so a very late item asymptotically approaches a zero score without ever being a hard cliff.
- Grade is (re-)computed automatically on save whenever `completion_date` is set (`before_save` hook), not editable directly by anyone.
- `/stats` page aggregates each leader's open count, completed count, and average grade (as a percentage) across all their completed items — `views/stats.erb`, `User#grade`.

**Communication / audit trail:**
- Every edit and delete is diffed and logged: before/after JSON blobs are compared field-by-field and a human-readable diff string is generated on demand (`ActionItemLog#diff` in `models/action_item_log.rb`), giving mentors a change history per item without a separate versioning library.
- Mentor-only `/log` page surfaces this history team-wide — gated by `ACTION_ITEMS_EDIT`.
- `GET /api/leaders` exposes all users as JSON (`User#wordpress_fields`, referenced but not shown in the surveyed tree — likely inherited from `cheesy-common`) for client-side leader-picker widgets.

## Integrations
None beyond the shared internal `cheesy-common` gem for SSO/auth and configuration (`CheesyCommon::Auth`, `CheesyCommon::Config`) — no email, chat, or third-party API calls in this repo. No Onshape/TBA/Slack/Discord/Google integration.

## Notable Implementation Details
- The exponential-decay lateness grade (`current_grade`) is the one genuinely reusable idea here: a smooth, self-scaling accountability score beats a binary done/not-done or a manually-assigned grade, and the half-life formula is simple enough to port to any stack in a few lines.
- The change-log pattern (store full JSON snapshots before/after, diff lazily on read) is a cheap way to get audit history without an event-sourcing framework — appropriate for a small, low-write internal tool but would not scale to high-churn tables.
- `POST /api/edit` is a generic single-field PATCH-by-name-value endpoint with a inline `# TODO: param checking, throw a 400` — no validation on `params[:name]`, so it can blind-write to any column via `ActionItem.where(:id => params[:pk]).update(params[:name] => params[:value])`. This is a real mass-assignment anti-pattern (any client that can reach the endpoint can rewrite `mentor`, `grade`, etc. by field name) worth explicitly avoiding in a re-implementation.
- `mentor` and `leaders` are stored/passed as free text and comma-joined ID strings respectively rather than proper relations end-to-end, reflecting the app's small internal scale rather than a pattern to copy.
- Auth, config, and even the "wordpress_fields" user serialization are pushed into an external shared gem (`cheesy-common`) not included in this repo — this survey cannot fully verify permission-string semantics or the config schema beyond what's inferred from call sites and `config.json`.

## Verdict
Thin but real: a thoroughly single-purpose, ~150-line Sinatra app whose only genuinely novel idea is the automatic exponential-decay lateness grade for holding student leaders accountable on task deadlines — worth stealing for any people/task-tracking feature; everything else (CRUD forms, generic PATCH endpoint, audit log) is standard and, in the PATCH endpoint's case, an anti-pattern to avoid rather than copy.
