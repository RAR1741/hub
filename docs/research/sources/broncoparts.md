# Bronco Parts — Source Survey

**Repo:** kyrofx/BroncoParts — https://github.com/kyrofx/BroncoParts
**Surveyed-at:** b4c147b49aad7d57e1913cda405248411f564053
**Permalink form:** https://github.com/kyrofx/BroncoParts/blob/b4c147b49aad7d57e1913cda405248411f564053/<path>
**Stack:** Python/Flask backend (SQLAlchemy + Alembic migrations, Flask-JWT-Extended), MySQL, React frontend (Create-React-App style, MUI theming), Docker Compose for local/prod, pyairtable for Airtable sync
**License:** ambiguous — no LICENSE file in the tree and `license` is `null` via the GitHub API, but `README.md` states "This project abides by the MIT License." A license claim in a README with no actual LICENSE file is not a valid grant; treat as **ideas only, do not copy code**.
**Last activity:** 2025-11-26 (pushed_at)
**FRC team:** unknown (no team number in README/code; explicitly a from-scratch modernization of "Cheesy Parts," which is Team 254's tool — this is a separate, unaffiliated rewrite, not 254's own repo)
**Areas:** parts ordering/POs; part design/manufacturing tracking

## Purpose
A from-scratch Flask/React rebuild of the classic "Cheesy Parts" Ruby/Sinatra app: tracks parts and assemblies through a design → material → manufacturing → done lifecycle within named projects, generates hierarchical part numbers automatically, and (partially) tracks procurement orders for materials/parts, with optional one-way sync of part data out to Airtable.

## Auth & Roles
- JWT-based auth (`flask_jwt_extended`) issued at `/api/login`; JWT payload carries `enabled` and `permission` claims.
- Three-tier RBAC via a `permission` string column on `User`: `readonly` < `editor` < `admin`, enforced with three stacked decorators in `backend/app/decorators.py`: `admin_required`, `editor_or_admin_required`, `readonly_or_higher_required`. Each decorator independently re-verifies the JWT, checks `enabled`, then checks the permission string — all three duplicate ~35 lines of near-identical try/except/log logic (see Notable Implementation Details).
- New self-registrations (`POST /api/register`) default to `enabled=False`, `is_approved=False`, `permission='readonly'` — an admin must call `POST /api/users/<id>/approve` to activate them.
- **Registration links** (`RegistrationLink` model, `backend/app/models.py:60-134`): admin-created invite links with a random token or admin-chosen `custom_path`, `max_uses` (or `-1` for unlimited), `current_uses`, optional `expires_at`, a configurable `default_permission`/`auto_enable_new_users` for accounts created through the link, and optional `fixed_username`/`fixed_email` for single-use pre-filled invites. `is_currently_valid_for_registration()` centralizes the active/expired/exhausted check. Routes: `POST/GET/PUT/DELETE /api/admin/registration-links[...]`, plus public `GET/POST /api/register/<link_identifier>` and an admin-assisted `POST /api/admin/create_user_via_link`.
- Password hashing via werkzeug's `generate_password_hash`/`check_password_hash` (not the PBKDF2/HMAC-SHA1 scheme described for the original Ruby app in `NEW_README.md` — that section documents the *old* Cheesy Parts implementation being replaced, not this codebase).

## Data Model
(`backend/app/models.py`)
- `User` — username/email/password_hash, `permission` string, `enabled`, `is_approved`, `requested_at`, optional `registered_via_link_id` FK to `RegistrationLink`.
- `RegistrationLink` — see Auth above; `creator` relationship back to `User`.
- `Project` — name, description, unique `prefix` (used in generated part numbers), `hide_dashboards` flag; has many `Part`s and `Order`s.
- `Part` — `numeric_id` + generated `part_number` (unique, format `{ProjectPrefix}-{A|P}-{NNNN}`), `type` (`assembly`|`part`), self-referential `parent_id`/`children` for assembly hierarchy, plus two more self-FKs `subteam_id`/`subsystem_id` used to tag a part with an "owning" subteam/subsystem part; `status` (free-text lifecycle stage), `quantity` (manufacturing qty), `raw_material`/`source_material`/`have_material`/`cut_length`/`quantity_required`, `priority` (0=High/1=Normal/2=Low), `drawing_created`, `notes`; FK to `Machine` and many-to-many to `PostProcess` via the `part_post_processes` association table; unique constraint on `(project_id, numeric_id)`.
- `Machine` / `PostProcess` — simple named, `is_active`-flagged lookup tables for manufacturing routing (e.g. CNC, laser, anodize) with Airtable-select-option sync helpers.
- `Order` / `OrderItem` — `Order` has `order_number`, `customer_name`, `project_id`, `status`, `total_amount`, `reimbursed`; `OrderItem` has `order_id`, `part_id`, `quantity`, `unit_price`, cascade-deletes with its parent order.

## Features

### Parts / assembly tracking (part design & manufacturing area)
- Auto-generated hierarchical part numbers: assemblies increment in steps of 100 (`XXX-A-0100`, `0200`, ...), child parts increment from their parent assembly's number (`XXX-P-0101`, `0102`, ...) — logic lives in `POST /api/parts` (`backend/app/routes.py:170-520`), which also derives ancestor lookups via a recursive `get_ancestor_at_level` helper.
- Rich lifecycle `status` field with ~19 documented stages (`designing`, `material`, `ordered`, `drawing`, `ready`, per-machine ready states like `cnc`/`laser`/`lathe`/`mill`/`printer`/`router`, `manufacturing`, `outsourced`, `welding`, `scotchbrite`, `anodize`, `powder`, `coating`, `assembly`, `done`) — documented in `NEW_README.md`.
- Assembly/part hierarchy with parent/child tree endpoint: `GET /api/projects/<id>/tree` (`routes.py:106`) recursively formats a nested part tree for the frontend's "tree view" (`frontend/src/components/ProjectTreeView.js`).
- Machine and post-process tagging on parts (many-to-many for post-processes), with dedicated CRUD + Airtable-option-sync endpoints: `/api/machines`, `/api/machines/airtable-options`, `/api/machines/sync-with-airtable`, and equivalents for `/api/post-processes`.
- Subteam/subsystem self-referential tagging on parts for organizational grouping, surfaced via `GET /api/parts/derived-hierarchy-info` and `GET /api/projects/<id>/assemblies`.
- Priority (High/Normal/Low), material tracking (`have_material`, `source_material`, `cut_length`, `quantity_required`), and drawing-completion flag (`drawing_created`) as first-class fields, editable via `PUT /api/parts/<id>` (`routes.py:1000-1141`).
- Deletion guard: an assembly with child parts cannot be deleted (per `NEW_README.md`; enforced in `delete_part`).
- Full part CRUD: `POST/GET/PUT/DELETE /api/parts[...]` and per-project listing `GET /api/projects/<id>/parts`.
- Frontend part detail/edit/create views: `frontend/src/components/PartDetails.js`, `EditPart.js`, `CreatePart.js`, `Parts.js`.

### Parts ordering / POs
- `Order`/`OrderItem` procurement model tied to a `Project`, with order-level `status`, `total_amount`, `reimbursed` flag, and a computed `order_number`.
- Full CRUD REST surface: `POST/GET/PUT/DELETE /api/orders[...]`, plus nested order-item endpoints `POST/PUT/DELETE /api/orders/<id>/items[...]` (`routes.py:1500-1823`).
- README explicitly flags this area as incomplete: "Database and forms have the ability for this - not implemented fully right now" — treat as a schema/skeleton more than a finished ordering workflow.

### Project management
- Project CRUD (`POST/GET/PUT/DELETE /api/projects[...]`) with a unique `prefix` driving part numbering and a `hide_dashboards` toggle to exclude a project from dashboard listings.
- Frontend: `Projects.js`, `CreateProject.js`, `EditProject.js`, `ProjectDetails.js`, `ProjectDashboard.js`, `ProjectDashboardParts.js`.

### User management / onboarding (people area, secondary)
- Admin user CRUD: `POST /api/admin/users`, `GET/PUT/DELETE /api/users[/<id>][...]`, `POST /api/users/<id>/approve`, `PUT /api/users/<id>/change-password`.
- Self-service registration (open and via registration link) with pending-approval gating, described above.
- Simple usage stats endpoints: `GET /api/stats/active-users`, `/api/stats/projects`, `/api/stats/parts`.
- Frontend: `AccountManagement.js`, `AdminRegistrationLinks.js`, `CreateUser.js`, `EditUser.js`, `Register.js`, `RegisterViaLink.js`, `UserSettings.js`, `Login.js`.

## Integrations
- **Airtable** (`backend/app/services/airtable_service.py`) — one-way sync of part data (name, subteam, subsystem, manufacturing quantity, status, machine, raw material, post-processes, notes) into an Airtable base via `pyairtable`. Includes logic to validate values against Airtable single/multi-select field choices before syncing, and two separate strategies for adding a brand-new choice to a single-select field when the current value isn't already an option: (1) a "typecast" trick — POST a temporary record with `typecast=True` so Airtable auto-creates the missing option, then immediately delete that record; (2) a fallback direct call to Airtable's Metadata API to PATCH the field's `choices` list. If both fail (e.g. field is restricted, or a conservative 45-choice safety cap is hit), it logs verbose step-by-step manual-fix instructions rather than silently failing.
- No Slack/Discord/SMS/calendar/Onshape integration found — Airtable is the only external system.
- Optional Gmail SMTP email mentioned only in `NEW_README.md`'s description of the *original* Ruby app being replaced (via the Pony gem) — not present in this Flask codebase's routes/services.

## Notable Implementation Details
- `NEW_README.md` is effectively a spec/migration doc: it describes the *original* Ruby/Sinatra/MySQL/Sequel "Cheesy Parts" app's file layout and PBKDF2 password scheme in detail as background/reference, then a separate "conceptual" data model section for the rebuild. Do not confuse the original-app description with what's actually implemented in `backend/`; cross-check against `models.py`/`routes.py` for ground truth (e.g. password hashing is werkzeug-based here, not PBKDF2/HMAC-SHA1).
- The three permission decorators in `decorators.py` are almost entirely duplicated boilerplate (JWT verification, exception handling, enabled/permission checks) differing only in the final permission-string comparison — a straightforward candidate for a single parameterized `require_permission(min_level)` decorator if reimplementing.
- Heavy `print()`-based debug logging is baked directly into the auth decorators (`_log_decorator_details`, `_log_verification_attempt`, etc.) rather than using the `logging` module — looks like leftover debugging instrumentation, not intentional structured logging.
- Airtable field-choice management goes through real production trial-and-error: the code comments and two parallel option-adding strategies (typecast-then-delete vs. Metadata API PATCH) reflect that Airtable's API doesn't offer a clean documented way to add a single-select choice, worth remembering if recreating an Airtable-integration feature.
- Test suite is fairly extensive for a small team app: `backend/tests/` has unit + integration suites (auth, parts, orders, projects, users, machines/post-processes, statistics, error handling, performance) plus a separate `backend/testing/` folder with ad hoc Airtable sync scripts — signals the Airtable sync path was iterated on/debugged significantly outside the main test suite.
- Frontend is a fairly standard CRA + MUI React app (`ThemeModeContext.js` for light/dark mode, `AuthContext.js` for JWT storage) with per-component Jest tests under `__tests__/`.

## Verdict
Substantive and relevant: a real, moderately complete Flask+React parts/assembly/manufacturing tracker with working hierarchical part numbering, lifecycle status tracking, machine/post-process tagging, and a genuinely useful two-strategy Airtable single-select sync trick — worth stealing conceptually (part-numbering scheme, decorator consolidation opportunity, Airtable choice-sync fallback pattern). The order/PO side is explicitly unfinished per the README, so treat that area as schema-only inspiration, not a proven workflow. License is ambiguous (README claims MIT, no LICENSE file) — treat as ideas only.
