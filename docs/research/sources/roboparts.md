# RoboParts — Source Survey

**Repo:** techplexengineer/roboparts — https://github.com/techplexengineer/roboparts
**Surveyed-at:** e8bb5b1d5e735790803fe1d89ac8d5c282aa6196
**Permalink form:** https://github.com/techplexengineer/roboparts/blob/e8bb5b1d5e735790803fe1d89ac8d5c282aa6196/<path>
**Stack:** Go (module `github.com/techplexengineer/gorm-roboparts`), Echo v4 web framework, GORM (MySQL or SQLite via config), `gormstore` (DB-backed sessions), server-rendered `html/template` views (Bootstrap 5), go-playground/validator
**License:** none (all rights reserved) — no LICENSE file in the tree and `license` is null via the GitHub API; ideas only, do not copy code. Code comments show it is a from-scratch Go reimplementation of Ruby-based cheesy-parts-style logic (commented-out Ruby/Sequel snippets left in `models/Part.go` and `models/Order.go` as design notes, e.g. `PRIORITY_MAP`, `STATUS_MAP`).
**Last activity:** 2021-04-21 (pushed_at) — dormant, early-stage skeleton, not actively developed
**FRC team:** unknown (author handle "techplexengineer"; no team number found in README/config — repo has no README at all)
**Areas:** part design/manufacturing tracking (primary); parts ordering/POs (Order/OrderItem/Vendor models); people/rosters (User/Role/Permission, thin)

## Purpose
An early-stage, Go-native rebuild of the classic cheesy-parts workflow: track a project's parts (raw/assembly/COTS), their manufacturing status/priority, and the vendor orders used to source materials for them. Intended to replace a prior implementation (design comments reference Sequel/Ruby ORM idioms being ported to GORM) but as committed is mostly scaffolding — the data model and auth/session plumbing are built out, while most CRUD controllers are unimplemented stubs.

## Auth & Roles
- Username/password login (`controllers/user/user.go` `LoginPOST`) — looks up by username OR email, verifies with bcrypt (`helpers/password.go`, cost 14).
- Session-backed login state via `gormstore` (GORM-persisted, encrypted/authenticated cookie sessions) wired in `main.go` with a periodic (hourly) expired-session cleanup goroutine; session helpers in `helpers/usersession.go` (`CreateUserSession`, `GetCurrentUser`, `IsLoggedIn`, `Logout`) store just the username in the session.
- A second, unused/legacy session implementation exists side-by-side (`helpers/session.go`, `securecookie`-based, stores a `userUUID`) — dead code, not wired into `main.go`.
- Role model exists (`models/Role.go`, `models/Permission.go`) with many2many User↔Role, User↔Permission, Role↔Permission join tables, but nothing in the controllers reads or enforces them — no route-level RBAC is implemented (`controllers/admin/user/user.go` is a single unguarded `ListUsers` stub).
- Registration/forgot-password/edit-account/delete-account routes exist (`main.go`) but their handlers just render static templates with no logic (`controllers/user/user.go`).

## Data Model
GORM models, each embedding a common `Common` struct (`models/modelcommon.go`) that gives every table a UUID primary key (generated in `BeforeCreate`), `CreatedAt`/`UpdatedAt`, and soft-delete (`DeletedAt`).

- **Project** (`models/project.go`) — `Name` (unique), `PartPrefix`, `Archived`, `Notes`; has many `Part`, many2many `Order` (via `projects_orders`).
- **Part** (`models/Part.go`) — `PartNumber`, `Type` (part/assembly/COTS), `Name`, `Notes`, `Status`, `SourceMaterial`, `HaveMaterial`, `Quantity`, `CutLength`, `Priority`, `DrawingCreated`; self-referential `ParentPart`/`ChildrenParts` for assembly hierarchy (BOM tree); belongs to `Project`. Commented-out Ruby design notes in the same file document the intended status pipeline (designing → material → ordered → drawing → ready → cnc/laser/lathe/mill/printer/router → manufacturing → outsourced → welding → scotchbrite → anodize → powder → coating → assembly → done) and per-project auto-incrementing part-number generation logic — none of this is implemented in Go yet, only planned in comments.
- **COTSPart** (`models/COTSPart.go`) — off-the-shelf part: `Name`, `PartNumber`, `QtyPerUnit`, `UnitCost`, `Link`, `Notes`; belongs to `Vendor`.
- **Vendor** (`models/Vendor.go`) — `Name`, `PartPrefix`, `Notes`; has many `COTSPart`, has many `Order`.
- **Order** (`models/Order.go`) — `Status`, `OrderedAt`, `PaidForBy`, `TaxCost`, `Notes`; has many `OrderItem`; belongs to `Vendor`; many2many `Project`. Commented Ruby notes describe intended `subtotal`/`total_cost` calculation methods (not yet ported).
- **OrderItem** (`models/OrderItem.go`) — `Quantity`, `Description`, `UnitCost`, `Notes`; links `Project`, `Order`, and `Part`; has an implemented `TotalCost()` helper (`unitCost * quantity`).
- **User** (`models/User.go`) — `Username`, `Email` (unique), `PasswordHash`; many2many `Role`, many2many `Permission`.
- **Role** / **Permission** — many2many to `User` and to each other, standard RBAC join-table shape, unused by app logic.

All models auto-migrated in `main.go` (`db.AutoMigrate(...)`), and all implement a `String()` JSON-dump method for debug logging.

## Features

**Part design/manufacturing tracking**
- Part/assembly/COTS type distinction with self-referential parent/child links for building a BOM tree per project (`models/Part.go`).
- Per-part manufacturing metadata fields: status, priority (int, mapped in design comments to High/Normal/Low), source material, "have material" flag, cut length, quantity, and a `DrawingCreated` boolean — all fields present in the schema, but no controller/route yet exposes part CRUD (there is no `controllers/part` package at all in this commit).
- Detailed status-pipeline vocabulary is fully specified in code comments (`models/Part.go`) mirroring cheesy-parts' stage names (CNC/laser/lathe/mill/3D-printer/router/welding/anodize/powder-coat/etc.) — useful as a ready-made status taxonomy even though unimplemented.
- Project CRUD is implemented end-to-end for Create and Read/List; Update and Delete are routed but render placeholder templates only (`controllers/project/controller.go`: `UpdatePOST` and `Delete` ignore their input and just re-render a static page).
- Generic reflection-driven auto-form rendering (`helpers/templates.go` `getMembers`/`getColumns`) that inspects a struct's fields via reflection and Go struct tags (`ui:"-"` to hide a field, `ui:"textarea"` for multi-line) to auto-generate Bootstrap form fields (`partials/autoform/affield.html`, `partials/autoform/list.html`) — lets new model fields appear in create/list views without hand-writing template markup.
- Server-side struct-tag validation (`go-playground/validator`) surfaced back to the same form via a `getValMessage`/`isValid` template helper pair that maps failed field names to Bootstrap `is-invalid` classes (`helpers/validation.go`, `helpers/templates.go`).

**Parts ordering/POs**
- Order → OrderItem → Part/Project linkage models a vendor purchase order with per-line-item cost, quantity, and free-text notes; `OrderItem.TotalCost()` computes line total (`models/OrderItem.go`).
- Vendor entity separates COTS-catalog parts from orders, with a vendor-specific part-number prefix field (`models/Vendor.go`), mirroring the Project-level part-prefix convention.
- Order status and multi-project association (many2many, so one purchase order can supply several projects at once) are modeled but have no controller/route implemented in this commit.

**People/rosters**
- User/Role/Permission many2many schema is present but entirely inert — no admin UI beyond a stub user list, and no middleware checks roles/permissions on any route.

## Integrations
None. No third-party API/service integrations (no Onshape, Slack, TBA, email, etc.) are present in this codebase — it is a self-contained Go server with only a SQL database backend (MySQL or SQLite, chosen via `config.json`).

## Notable Implementation Details
- **Reflection-based auto-form generator** (`helpers/templates.go`) is the most reusable idea here: it walks a Go struct via `reflect`, maps field kind → HTML input type (bool→checkbox, numeric→number, string→text, nested struct→recurse), and respects a `ui:"-"`/`ui:"textarea"` tag to control visibility/widget — a lightweight alternative to hand-maintaining parallel Go structs and HTML templates for every model.
- Config is a flat JSON file (`config.json`, `config.go`) holding DB type/DSN and session auth/encryption keys; a `-x` CLI flag prints a freshly-generated example config (random keys) to stdout for bootstrapping a new deployment.
- Session store persists to the same GORM database (`gormstore`) rather than an in-memory/Redis store, so sessions survive app restarts without a separate cache service; includes a background goroutine for periodic expired-session cleanup (started but never gracefully stopped — the `quit` channel is created and left unused, `main.go`).
- Rate limiting is applied globally via Echo middleware (`middleware.RateLimiter`, 20 req/s memory store) rather than per-route or per-user.
- Dead/parallel code: `helpers/session.go` implements a second, `securecookie`-based session mechanism that is never referenced from `main.go` — a reimplementer should just drop it rather than treat it as the "real" auth path.
- Significant scaffolding gap: registration, password reset, account edit/delete, admin user management, part CRUD, order CRUD, and vendor CRUD all have either no route or a route that renders a static template with no backing logic — treat this repo as a schema/pattern reference, not a working app.
- `.deepsource.toml` present (static analysis config) suggesting some CI/code-quality intent even though the app itself is incomplete.

## Verdict
Marginal-but-useful: a dormant (2021), incomplete Go skeleton where the data model (Part/Project/Order/Vendor/COTSPart with BOM self-reference and cheesy-parts-style status taxonomy documented in comments) and the reflection-driven auto-form pattern are worth stealing as ideas, but almost none of the actual manufacturing/ordering workflow logic is implemented — most controllers are stubs. No license file, so ideas only, do not copy code.
