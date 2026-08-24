# FRC Project Management System — Source Survey

**Repo:** jakec1020/frc-project-management — https://github.com/jakec1020/frc-project-management
**Surveyed-at:** 9d9e54c5dff902361033aa8a958cff32602f0007
**Permalink form:** https://github.com/jakec1020/frc-project-management/blob/9d9e54c5dff902361033aa8a958cff32602f0007/<path>
**Stack:** Ruby on Rails 4 (Ruby, ERB + CoffeeScript/jQuery views, Bootstrap 3), SQLite/ActiveRecord
**License:** none (all rights reserved) — no LICENSE file present — ideas only
**Last activity:** 2015-03-09 (pushed_at; repo unmaintained since)
**FRC team:** Team 1245 (per README/description)
**Areas:** (6) part design/manufacturing tracking — only loosely, as a generic task/to-do assignment tool; does not model parts, drawings, or manufacturing status specifically

## Purpose
A minimal Rails CRUD app for FRC Team 1245 to track a flat list of team "todos" (tasks) with due dates, assign them to members, flag past-due items, and keep a basic member contact list. It is a generic task tracker, not a parts/build-tracking system — despite the "Project Management System" name, there is no concept of subsystems, parts, robot components, or build stages.

## Auth & Roles
- Custom (non-Devise) auth: `has_secure_password` on `User` (bcrypt), session-based login via `SessionsController` (`app/controllers/sessions_controller.rb`) and `sessions_helper.rb`.
- Two boolean role flags on `User`: `admin` and `head` (db/migrate/20150108182743_add_admin_to_users.rb, 20150122190255_add_head_to_users.rb) — no roles table, just two booleans.
- Permission enforcement is entirely in controller `before_action` filters, e.g. `admin_user`/`correct_user` in `app/controllers/users_controller.rb`, and `assigning_user` (admin-or-head gate on assignment/admin todo views) in `app/controllers/todos_controller.rb`.
- No password reset, no email verification, no remember-me token beyond default Rails session cookie.

## Data Model
Two tables only (`db/schema.rb`):
- `users`: email, first, last, password_digest, phone, admin (bool), head (bool), timestamps.
- `todos`: task (text), due (date), done (bool, default false), user_id (FK), who (string — assigner's name, redundant with user_id), timestamps.
- One relationship: `User has_many :todos, dependent: :destroy`; `Todo belongs_to :user` (`app/models/user.rb`, `app/models/todo.rb`).
- `Todo` default_scope orders by `due: :asc`.

## Features
### Task/to-do tracking (closest analogue to area 6, generic — not part-specific)
- Personal task panel per user showing their own todos — `app/controllers/todos_controller.rb#panel`, view `app/views/todos/panel.html.erb`.
- Inline AJAX create/edit/update/destroy/toggle-done for todos via `.js.erb` templates (`app/views/todos/create.js.erb`, `update.js.erb`, `destroy.js.erb`, `checked.js.erb`) and `app/assets/javascripts/todos.js.coffee`.
- Admin/head-only "assign" flow: pick a user from a dropdown and create a task for them with a due date — `todos_controller.rb#assign`, `#assigner`, view `_assignform.html.erb`.
- "Past due" report listing every todo whose due date has passed, computed in Ruby (`past_due` helper, `todos_controller.rb#past`, `app/helpers/todos_helper.rb`).
- "Season" view — full todo list across all users reordered by `updated_at` (`todos_controller.rb#season`, view `season.html.erb`).
- Admin/head "index" view of literally all todos across the team (`todos_controller.rb#index` + `all_todos` before_action).
- Checkbox-driven done/undone toggle client-side (`app/assets/javascripts/checkbox.js`).

### People/roster (area 2, minor)
- Team member directory/contact list: `UsersController#index`/`#show` list all users with phone/email (`app/views/users/index.html.erb`, `show.html.erb`) — described in README as "a centralized contact list."
- Self-service profile edit gated to the owning user or an admin (`correct_user` filter).
- Admin-only user deletion (`admin_user` filter, `UsersController#destroy`).

## Integrations
None. No calendar, Slack/Discord, email, SMS, TBA, or Onshape integration. Pure self-contained Rails CRUD app.

## Notable Implementation Details
- Rails 4-era conventions throughout (`ActiveRecord::Schema.define`, old-style `render :new` without symbols-as-strings changes, `validates_format_of`) — a re-implementer targeting a modern stack gets essentially nothing reusable code-wise, only the feature shape.
- Role model is two independent booleans (`admin`, `head`) rather than an enum/role table — brittle if more roles are ever needed, but trivially simple to reason about at this scale.
- `who` column on `todos` (string name of assigner) is denormalized/redundant given `user_id` — a data-modeling anti-pattern worth avoiding in a re-implementation (store the assigner as a proper FK, e.g. `assigned_by_id`).
- Assignment UI builds its user dropdown by manually mapping `User.all` into `[label, id]` pairs in the controller (`todos_controller.rb#assign`) rather than using a model-level scope/helper — fine at small team scale (~dozens of users), would not scale.
- No test coverage beyond default Rails scaffolds (`test/` has boilerplate fixture/model/controller tests, nothing behavior-specific of note).

## Verdict
Thin and only marginally relevant: it's a generic Rails to-do list with due dates and an admin-assigns-to-member flow, not a parts/manufacturing or build-tracking system despite its name — the one thing worth stealing is the simple "assign task with due date to a teammate + past-due report + personal task panel" shape, which the hub's existing task/checklist features likely already cover.
