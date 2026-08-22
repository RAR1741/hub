# db_material — Source Survey

**Repo:** oso1248/db_material — https://github.com/oso1248/db_material
**Surveyed-at:** 81e27b7c52076a132aadadd8f7145c9d14bc000c
**Permalink form:** https://github.com/oso1248/db_material/blob/81e27b7c52076a132aadadd8f7145c9d14bc000c/<path>
**Stack:** Python, FastAPI, SQLAlchemy ORM, Alembic migrations, PostgreSQL (UUID PKs via `pgcrypto`/`gen_random_uuid()`), python-jose JWT, `ratelimit` decorator, Postman collection for API testing, pytest unit tests
**License:** MIT (LICENSE file present at repo root) — free to reuse code directly, not just ideas.
**Last activity:** 2023-01-14
**FRC team:** unknown — this is **not an FRC/FTC project**; the GitHub repo description says "Inventory Api FTC" but the actual codebase is an inventory/production-tracking API for a **commercial brewery** (hops, brewing tanks, batches). Flagging this mismatch explicitly since the task context assumed FTC. Treated here as a comparable other-org (non-robotics) internal-ops tool per the survey's "comparable tools OK, label them" rule.
**Areas:** (5) parts ordering/POs — suppliers + commodity catalog; (6) part design/manufacturing tracking — recipe "brand" BOMs, batch/lot inventory, production-stage tracking (tank hibernation); (2) people/rosters — users with job-role assignment (thin)

## Purpose
A commercial brewery's internal REST API for tracking raw-material inventory (hops, other brewing commodities), supplier records, recipe definitions ("brands" with brewing/finishing/packaging stages and their bill-of-materials), and in-process production state (which tanks hold which batch, at what volume/gravity/alcohol readings). Not FRC/FTC-specific, but structurally close to a parts/inventory + BOM + supplier system a robotics team could adapt for parts ordering and build tracking.

## Auth & Roles
- OAuth2 password-flow JWT auth (`api/oauth2/oauth2.py`): `python-jose` signs/verifies a JWT carrying `id`, `eid`, `name`, `permissions`, `is_active`; `get_current_user` dependency decodes the bearer token and loads the user row, rejecting inactive accounts.
- Login/reset/change-password endpoints: `api/routers/rte_auth.py`. Login checks `is_active` then bcrypt-style hash verify (`api/utils/utils.py`); password reset generates a random temp password and can email it (`api/utils/utils_email.py`); change-password validates new password against a regex (`api/validators/regex/regex_users.py`).
- Authorization is a single integer `permissions` column on `Users` (`api/models/mdl_users.py`), checked ad hoc per route as `current_user.permissions < N` (thresholds like 1/5/7 seen across routers) — no named roles or RBAC table, just numeric levels hardcoded at each call site.
- Hardcoded protections: user id `1` (superadmin) and eid `aa00000` are special-cased and blocked from edit/delete in `api/routers/rte_users.py`.
- Per-route rate limiting via `ratelimit` decorator (`@sleep_and_retry @limits(calls=N, period=S)`) stacked on nearly every endpoint — e.g. 5 calls/20s on auth routes, 20 calls/10s on CRUD routes.

## Data Model
- **Users** (`api/models/mdl_users.py`): employee id (`eid`), name, hashed password, integer `permissions`, `is_active`, self-referential `created_by`/`updated_by` audit columns (pattern repeated on every table in the schema).
- **JobsBrewing** + **BridgeJobsBrewing**: many-to-many between users and named brewing jobs/stations (`name_job`, `name_area`, `job_order`), with an `skap` code per assignment — a lightweight roster/role-assignment model.
- **Suppliers** (`mdl_suppliers.py`): name, contact, email, phone, active flag.
- **Commodity** (`mdl_commodity.py`): raw-material catalog row — local/bit/common names, `type`, `sap` code, unit of measure, `per_unit`/`per_pallet` quantities, FK to `Suppliers`. This is the "part catalog" analog.
- **BrandBrewing → BrandFinishing → BrandPackaging** (`mdl_brands.py`): a 3-stage recipe/product hierarchy (brew stage → finishing stage → packaging stage) with boolean process flags (`is_organic`, `is_dryhop`, `is_preinjection`, etc.) — essentially a BOM/routing tree for a manufactured product.
- **BridgeAddition / BridgeKettleHop / BridgeDryHop** (`mdl_bridges_brewing.py`): per-brand-per-commodity join tables carrying `per_brew` quantity — the actual bill-of-materials (how much of each commodity goes into each recipe stage).
- **InventoryUUID** (`mdl_inventory.py`): a daily inventory "snapshot" keyed by UUID + unique `inventory_date`, fanning out to child tables:
  - `InventoryMaterial` — commodity counts/totals for that snapshot.
  - `InventoryHop` — hop-specific counts with `lot_number` and `is_current` lot flag, linked to `InventoryLastBrews`.
  - `InventoryLastBrews` — last-used lot codes (`bh_1`, `bh_2`) per snapshot.
  - `InventoryHibernate` — in-process batch tracking: origin tank/level, storage tank/level, gravity/ABW/O2 readings, final tank, `is_complete` flag — i.e. work-in-process tracking through production stages.
- Every table carries `created_by`/`updated_by` (FK to Users) + `time_created`/`time_updated` audit columns — a consistent audit-trail convention applied schema-wide.

## Features
**Parts ordering / commodity & supplier management (area 5)**
- Supplier CRUD with active/inactive soft-delete flag — `api/routers/rte_suppliers.py`, `api/models/mdl_suppliers.py`.
- Commodity (parts/materials) catalog CRUD with unit-of-measure, per-unit/per-pallet quantities, and supplier linkage — `api/routers/rte_commodity.py`, `api/models/mdl_commodity.py`.
- Regex-validated input classes per entity (e.g. `api/validators/regex/regex_commodity.py`, `regex_suppliers.py`) enforced before DB writes via Pydantic validator classes (`api/validators/classes/cls_commodity.py`).

**Manufacturing / recipe & batch tracking (area 6)**
- 3-tier recipe/BOM model (brew → finish → package) with per-commodity quantity-per-brew bridge tables — `api/models/mdl_brands.py`, `api/models/mdl_bridges_brewing.py`, `api/routers/rte_bridges_brewing.py`.
- Daily inventory snapshot pattern: one `InventoryUUID` row per date fanning out to material/hop/hibernate child rows, letting historical inventory counts be reconstructed per day — `api/models/mdl_inventory.py`, `api/routers/rte_inventory.py`.
- Lot-tracking for hops: `lot_number` + `is_current` flag lets the system track which lot is actively in use vs. historical — `InventoryHop` in `mdl_inventory.py`.
- Work-in-process batch tracking through tanks: origin tank → storage tank (with gravity/ABW/O2 readings) → final tank, with an `is_complete` flag — `InventoryHibernate` in `mdl_inventory.py`.
- Issue-tracking router for flagging problems against jobs/production — `api/routers/rte_issues.py`, `api/routers/metadata/md_issues.py` (only metadata/router present, worth checking model coverage before reuse).

**People / job assignment (area 2, thin)**
- Named "jobs" (brewing stations/roles) assignable to users many-to-many with a per-assignment code — `api/models/mdl_users.py` (`JobsBrewing`, `BridgeJobsBrewing`), `api/routers/rte_jobs.py`.

**Cross-cutting**
- Full CRUD + auth on every entity, generated consistently: router (`rte_*.py`) + metadata/docstrings (`routers/metadata/md_*.py`) + Pydantic validators (`validators/val_*.py`, `validators/classes/cls_*.py`, `validators/regex/regex_*.py`) — a strict 4-layer-per-entity convention.
- Password reset flow emails a random temporary password (`api/utils/utils_email.py`, `api/utils/utils.py::get_random_password`).
- Alembic migrations, one per feature area, matching the router/model split (`alembic/versions/*`).
- Postman collection + environment checked into the repo for manual API testing (`postman/db_material.postman_collection.json`).
- Unit tests organized per-domain under `unit_tests/` (auth, brands, commodity, inventory — including hop/hibernate/lastbrews/material sub-suites, suppliers, users).

## Integrations
None — no Onshape/TBA/Slack/Discord/SMS. Only integration is outbound email for password reset (`api/utils/utils_email.py`, generic SMTP-style, not a named provider evident from file name alone).

## Notable Implementation Details
- **Consistent 4-file-per-entity convention** (model / router / metadata-docstring / validator-triplet) is a clean pattern to imitate for a growing FastAPI app — easy to navigate, if verbose.
- **Authorization is scattered integer checks** (`current_user.permissions < N`) repeated in every handler rather than centralized as decorators/dependencies — an anti-pattern to avoid; a reimplementation should centralize this as a reusable FastAPI dependency parameterized by required level.
- **Daily-snapshot inventory pattern** (one row per date, fanned out to typed child tables) is a reusable idea for periodic stock-count features, distinct from continuous quantity-on-hand tracking.
- **Lot/lot-number + `is_current` flag** on hop inventory is a simple, worth-copying pattern for tracking active vs. historical material batches without a separate lot table.
- Self-referential audit columns (`created_by`/`updated_by` FK'd to `Users.id`, cascade-deleted) on every table is a heavy-handed but thorough audit convention; note the `ondelete='CASCADE'` on user FKs means deleting a user cascades and deletes everything they created/updated — likely a footgun in production (soft-delete via `is_active` is used elsewhere, inconsistently).
- Superadmin user (id=1) and a specific `eid` are hardcoded/special-cased in multiple route handlers rather than using a role flag — brittle if that user/id ever changes.
- Rate limiting via `ratelimit` library decorator per-route is simple but process-local (in-memory), not distributed — fine for a single-instance deploy, a ceiling to know about at scale.
- Small size (979KB) reflects a lean single-purpose service, not a large system — most value here is in the schema/routing conventions, not scale-tested features.

## Verdict
Substantive despite being off-topic-by-name (brewery, not FTC): a clean, MIT-licensed, small FastAPI+SQLAlchemy reference for a supplier/commodity catalog, multi-stage recipe BOM, and daily-snapshot lot-tracked inventory — worth stealing the daily-inventory-snapshot pattern, the lot/`is_current` tracking idea, and the recipe/BOM bridge-table shape for a parts-ordering or manufacturing-tracking feature; skip the scattered-permission-check auth pattern.
