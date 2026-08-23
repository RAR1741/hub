# rzblue/gatherpack — Source Survey

**Repo:** rzblue/gatherpack — https://github.com/rzblue/gatherpack
**Surveyed-at:** 7cad226bf1ce8a694299352f0b10fe9d5f467a2c
**Permalink form:** https://github.com/rzblue/gatherpack/blob/7cad226bf1ce8a694299352f0b10fe9d5f467a2c/<path>
**Stack:** Ruby on Rails ~8.1 monolith, PostgreSQL (separate `primary` + `versions` databases), Hotwire (Turbo + Stimulus), Bootstrap 5 via `cssbundling-rails`, Solid Queue/Cache/Cable (no Redis), Devise + OmniAuth, Pundit, Ransack, PaperTrail, money-rails, Stripe, Postmark
**License:** MIT, Copyright (c) 2024 Brad Thompson (`LICENSE.txt`) — free to copy/adapt with attribution, no ideas-only restriction
**Last activity:** 2026-05-31 (pushed_at)
**FRC team:** Not directly named in this fork; README states GatherPack originated with an FRC team whose volunteer/exec-director (Brad Thompson) and students built it — the specific team number is not stated in the repo
**Areas:** (1) time/attendance, (2) people/rosters, (3) third-party integrations (Stripe payments, Postmark email), (5) parts ordering/POs — via generic ledger/budget module, not a dedicated PO system

## Purpose

GatherPack is a self-hostable "manage a group of people" web app: it centralizes a member roster, a hierarchical team tree, event check-ins, time-clock punches/hours, badges/credentials, RFID tokens, financial ledgers/budgets, announcements, and inbound email mailboxes for an organization such as an FRC team. This fork (`rzblue/gatherpack`, a fork of `GatherPack/gatherpack`) is active and up to date with upstream as of May 2026, making it a good stand-in for the canonical project state.

## Auth & Roles

- Devise (`database_authenticatable, registerable, recoverable, rememberable, validatable`) plus OmniAuth providers `developer, google_oauth2, discord, github` (`app/models/user.rb`).
- First user created is auto-promoted to admin (`User#adminify_first_user`).
- Two global boolean flags on `User`: `admin` and `architect` (site-config/superuser level), checked via `Person#admin?` / `Person#architect?`.
- Team-scoped authorization is a derived "manager" concept, not a role table: `Membership#manager` boolean + a recursive team tree (`Team#all_ancestors`/`all_descendants`) gives "manage my team and its subteams" (`app/models/team.rb`, `app/models/person.rb` — `managed_teams`, `managed_people`, `all_managed_teams`).
- Authorization enforced per-model with Pundit policies (`app/policies/*_policy.rb`, one per resource) plus an `ApplicationPolicy` default-allow base class that subclasses override.
- Fine-grained per-record permission enums repeat across several models (`Team#join_permission`, `Badge#permission`, `CheckinField#permission`, `TimeClockPeriod#permission`, `RelationshipType#permission`): each accepts values like `added_by_admin`, `added_by_manager`, `added_by_current_member`/`added_by_team_member`, `has_account`, letting each *instance* of a resource (a specific badge, a specific time-clock period) set its own creation permission rather than a single global role matrix.
- `Token` model supports RFID-badge login/identification, polymorphic to any "tokenable" (`app/models/token.rb`) — includes card-format normalization for two different RFID reader output formats.
- `pretender` gem is present in the Gemfile (admin impersonation of another user).

## Data Model

- **Person** — profile (name, birthday, dietary restrictions, gender, shirt size, phone, address, avatar); optionally linked to a `User` (login) via `belongs_to :user, optional: true`, so a person can exist without ever having an account (e.g. a parent or a checked-in guest).
- **Team** — self-referential tree (`parent`/`children`), has a `TeamType`, `join_permission` enum, `has_many :memberships`.
- **Membership** — join table Person↔Team with a `manager` boolean.
- **Event** / **EventType** / **Checkin** / **CheckinField** / **CheckinFieldResponse** — an Event belongs to an EventType (which defines a set of custom CheckinFields, e.g. "bringing food?"); a Checkin is one Person's attendance record at one Event, with dynamic per-field responses whose editability is governed by the field's own permission enum (`app/models/checkin.rb`, `app/models/checkin_field.rb`).
- **TimeClockPeriod** / **TimeClockPunch** — a named date-range "period" (e.g. a build season) scoping punches; punches validate against the period's time bounds and permission enum; `TimeKiosk` (a non-persisted `ActiveModel::Model`) resolves an RFID token to a person and lists their available periods for a kiosk UI (`app/models/time_kiosk.rb`).
- **Badge** / **BadgeType** / **BadgeAssignment** — arbitrary awardable credentials/tags, optionally team-scoped, with a per-badge permission enum controlling who can assign it, plus a validation that the assignee is actually a member of the badge's team.
- **Relationship** / **RelationshipType** / **RelationshipNode** — a generic bidirectional/labeled-graph model for linking people (e.g. parent/child, mentor/student) with a permission enum and a graph-walk `distant_relatives` traversal (`app/models/person.rb`, `app/models/relationship.rb`).
- **Ledger** / **LedgerEntry** / **LedgerOwnership** / **LedgerTag** / **LedgerEntryLink** / **LedgerTransfer** / **LedgerPayment** — double-entry-ish financial ledgers owned by any polymorphic "owner" (currently `Person`), with split entries (parent/child entries with a "split difference" reconciliation check), entry-to-entry linking (e.g. linking a reimbursement to its receipt), tagging, and a materialized `balance_cents` refreshed on every entry save.
- **Budget** / **BudgetPeriod** — a budget is a target `amount_cents` for a set of `LedgerTag`s within a `BudgetPeriod` window; `actual_amount_cents` is computed by intersecting tagged ledger entries with the period's date range, giving percentage-spent tracking — the closest thing here to a purchasing/PO budget-vs-actual view.
- **Gateway** (STI: `Gateway::StripeGateway`, `Gateway::PostmarkSendingGateway`, `Gateway::PostmarkReceivingGateway`) — pluggable external-service connectors registered into named "slots" (`:payment`, `:email_sending`) via a class-level registry pattern.
- **Mailbox** / **MailboxMessage** / **MailboxAssignment** — inbound email address routed through Rails ActionMailbox-style processing into stored messages assignable to a target.
- **Announcement**, **CalendarNote**, **Page** (CMS), **Hook** (user-defined event-triggered Ruby snippets), **Report**, **Shortcut**, **Variable** (typed site-wide settings), **AuditLog** (PaperTrail versions, stored in a *separate* `versions` Postgres database).

## Features

**People/rosters**
- Full person profile with photo (webcam capture), dietary restrictions, shirt size, birthday, address (`app/models/person.rb`, `app/controllers/people_controller.rb`).
- Hierarchical team/subteam tree with per-team join permission (admin-added, manager-added, self-join, requires-account) and manager flag per membership (`app/models/team.rb`, `app/models/membership.rb`).
- Relationship graph between people (parent/child, mentor/mentee, etc. — user-defined `RelationshipType`s) with permission-gated creation and a graph traversal for "distant relatives" (`app/models/relationship.rb`, `app/models/relationship_node.rb`).
- Badges/credentials system: team-scoped or global badges, assignable under configurable permission rules, with membership validation (`app/models/badge.rb`, `app/models/badge_assignment.rb`).
- RFID/token identification tied polymorphically to any record (`app/models/token.rb`).

**Time/attendance**
- Event + EventType model with custom per-event-type check-in fields (dynamic form fields per event, e.g. "carpooling?"), and a per-event check-in count limit (`app/models/event.rb`, `app/models/checkin.rb`, `app/models/checkin_field.rb`).
- Time-clock punches scoped into named periods (seasons), each period carrying its own creation-permission rule and start/end bounds that punches must fall within (`app/models/time_clock_punch.rb`, `app/models/time_clock_period.rb`).
- "Too long" and "near duplicate" punch-anomaly scopes for admin cleanup — flags punches over a configurable max-hours threshold and overlapping/duplicate punches for the same person via a self-join SQL scope (`TimeClockPunch.too_long`, `TimeClockPunch.near_duplicates`).
- RFID-kiosk-facing punch flow (`app/models/time_kiosk.rb`, `app/controllers/time_kiosk_controller.rb`) that resolves a scanned token to a person and shows only the time-clock periods they're eligible for.
- Hours computed to the nearest 0.05h for both events and punches, including "hours so far" for a still-open punch.
- Period-level roll-ups: `available_hours` (rounded, completed events within the period) vs `total_hours`.

**Communication**
- Team-scoped Announcements with a visibility window (`start_time`/`end_time`) and an optional "notify now" digest send (`app/models/announcement.rb`, `app/services/announcement_notification_router.rb`).
- Inbound email mailboxes: a `Mailbox` has an address, receives `MailboxMessage`s (with attachments) via a configured receiving gateway, and routes them to assignable targets (`app/models/mailbox.rb`, `app/mailboxes/incoming_mailbox.rb`).
- Outbound email via a pluggable `Gateway::PostmarkSendingGateway`, queued through `SendEmailJob` (`app/models/gateway/postmark_sending_gateway.rb`, `app/jobs/send_email_job.rb`).
- User-defined "Hooks" — arbitrary Ruby code snippets that run on model lifecycle events (create/update/destroy) across a fixed catalog of hookable models, including a `token - activate` event (`app/models/hook.rb`, `app/models/concerns/can_be_hooked.rb`).

**Finance / parts-adjacent (ledgers & budgets, not a dedicated PO system)**
- Polymorphic-owner ledgers with entries, splits (parent/child entry reconciliation with a "split difference" check), entry-to-entry linking, and tagging (`app/models/ledger.rb`, `app/models/ledger_entry.rb`).
- Stripe-backed online payments: creates an unfinalized `LedgerEntry`, opens a Stripe Checkout session, and finalizes/fails the entry from the Stripe webhook (`app/models/gateway/stripe_gateway.rb`).
- Budget periods with per-tag target amounts and automatic actual-vs-target percentage tracking, scoped by ledger-entry tags intersected with the budget period's date range (`app/models/budget.rb`, `app/models/budget_period.rb`).

**Platform/admin**
- Full-history audit log via PaperTrail, stored in a dedicated second Postgres database (`versions`) separate from primary data (`app/models/audit_log.rb`, `app/models/abstract_version.rb`).
- Typed site-wide `Variable` settings (string/int/float/JSON "structure") with a code-level `add_setting` DSL described in the README (`app/models/variable.rb`, `lib/settings.rb`).
- Ransack-powered search/filter and Kaminari pagination on essentially every resource (`ransackable_attributes`/`ransackable_associations` defined per model).
- Small internal CMS (`Page` model) and per-team "Shortcuts."

## Integrations

- **Stripe** — online payments via Checkout Sessions, reconciled through signed webhooks (`app/models/gateway/stripe_gateway.rb`).
- **Postmark** — both outbound transactional email (`postmark-rails`) and inbound mail parsing/receiving gateway (`app/models/gateway/postmark_sending_gateway.rb`, presumably a matching `postmark_receiving_gateway.rb`).
- **OAuth/SSO**: Google, Discord, GitHub, plus a "developer" (local dev bypass) OmniAuth strategy (`app/models/user.rb`).
- No Slack/Discord messaging integration, no Onshape/CAD integration, no TBA integration found in this scope.

## Notable Implementation Details

- **Two-database split for audit history**: PaperTrail versions are written to a completely separate `versions` Postgres database/schema (`db/versions_schema.rb`, `AbstractVersion`), keeping high-churn audit rows off the primary DB's tables/indexes — worth considering if an audit trail on high-write tables (attendance, punches) risks bloating the primary schema.
- **Per-instance permission enums instead of a global role matrix**: rather than one RBAC table, individual records (a `Badge`, a `TimeClockPeriod`, a `RelationshipType`, a `CheckinField`) each carry their own `permission` enum (`added_by_admin`/`added_by_manager`/`added_by_team_member`/`added_by_user`/etc.), checked against the *acting* person's relationship to the relevant team at write time. This lets a team configure "who can self-report hours in this specific season" differently per season, at the cost of repeating similar permission-check logic in several models (`time_clock_punch.rb`, `relationship.rb`, `badge.rb` all hand-roll similar "created_by_manager?/created_by_team_member?" checks).
- **Recursive team-tree scoping computed in Ruby, not SQL**: `Team#all_descendant_ids`/`all_ancestor_ids` and `Person#all_team_ids` walk the tree in-memory via recursive Ruby methods rather than a recursive CTE — simple to read, but does one query per tree level and could be slow on a very deep/wide team hierarchy.
- **RFID normalization for two reader formats**: `Token.rfidify` strips a `5700` prefix and re-encodes hex-to-decimal for one class of reader while passing other formats through unchanged — a concrete gotcha worth carrying forward if RFID kiosks are in scope (`app/models/token.rb`).
- **`Hook#run` calls `eval(code, binding, name, 0)` on admin-authored Ruby snippets** stored in the database — powerful (arbitrary per-event automation) but a significant execution-of-stored-code surface; would need a sandboxed alternative (e.g. a restricted DSL or serverless function trigger) in a from-scratch rebuild rather than literal `eval`.
- **Ledger `mirror_amount`/split/link machinery** is one of the more sophisticated pieces here (splitting one entry into several child entries with a live "split difference" check, and separately linking unrelated entries such as a payment to its receipt) — a good reference model if budget/PO tracking needs entry reconciliation beyond a flat transaction list.
- Uses `neat_ids` for human-friendly prefixed IDs (e.g. `per_`, `evt_`, `tcp_`) layered over what still appear to be underlying database IDs — nice for URLs/logs without leaking sequential integer IDs.

## Verdict

Substantive and directly relevant: a mature, actively maintained (May 2026) MIT-licensed Rails app covering rostering, team hierarchy, attendance/check-ins, time-clock hours, and financial ledgers/budgets in real depth — worth mining for the per-instance permission-enum pattern, the recursive team-tree/manager model, the ledger split/link reconciliation design, and the two-database audit-log separation; the Stripe/Postmark gateway abstraction is also a clean pattern for a pluggable-integrations layer.
