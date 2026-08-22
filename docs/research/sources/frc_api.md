# FRC_API — Source Survey

**Repo:** MNTadros/FRC_API — https://github.com/MNTadros/FRC_API
**Surveyed-at:** d306eea11af49b46eb4aa1bbfdabaac74b6ef934
**Permalink form:** https://github.com/MNTadros/FRC_API/blob/d306eea11af49b46eb4aa1bbfdabaac74b6ef934/<path>
**Stack:** Python, FastAPI, SQLAlchemy Core (`databases` async wrapper) + SQLite, Pydantic v2, python-jose (JWT), passlib/bcrypt
**License:** none — no LICENSE file in the tree; all rights reserved. Ideas only.
**Last activity:** 2025-09-30
**FRC team:** unknown (author is "MNTadros"; no team number in README or code)
**Areas:** (5) parts ordering/POs — public parts catalog + per-team inventory tracking (not true purchase-order workflow, but closest of the six areas); marginal touch on (6) part design/manufacturing tracking via CAD-file links

## Purpose
A small hosted API (live demo on Render) that lets an FRC team browse a shared public catalog of real FRC parts (motors, etc. with vendor/cost/availability/CAD/image metadata) and maintain their own team-scoped inventory of components, optionally linked back to a public catalog entry. It is explicitly a backend/API only — no frontend UI ships in this repo.

## Auth & Roles
- JWT bearer auth via OAuth2 password flow (`/token`), `python-jose` HS256 tokens, 30-minute expiry (`app/auth.py`).
- Passwords hashed with bcrypt via `passlib`.
- Registration (`/register`) creates a user with `role: "member"` hardcoded; a `role` column exists on the `users` table but nothing in the code branches on it — effectively unused/unenforced.
- Authorization is team-scoped, not role-scoped: `check_team_access()` (`app/auth.py`) simply compares `user.team_id` to the requested `team_id` and 403s on mismatch. All team-component write/read endpoints depend on `get_current_active_user` + this check.
- Public-component endpoints (create/update/delete/search/list) have **no auth dependency at all** — anyone can CRUD the shared public catalog. This looks like an oversight/prototype gap rather than a deliberate design (worth noting as an anti-pattern, not a pattern to copy).
- `SECRET_KEY` is required from env at import time (`app/auth.py` raises `RuntimeError` if unset) — a reasonable fail-fast pattern.

## Data Model
Three SQLAlchemy Core tables (`app/models.py`), no ORM classes:
- **`public_components`**: `id` (string SKU/part number, PK), `name`, `vendor`, `category`, `cost`, `source` (URL), `description`, `image_url`, `cad_file_url`, `availability`. Shared catalog, not team-owned.
- **`team_components`**: autoincrement `id`, `team_id`, optional FK `public_component_id` → `public_components.id` (nullable — a team item can be freestanding or inherited from the catalog), `name`/`vendor` (can override the public values), `quantity`, `location`, `notes`, `added_by`, `last_updated` (auto now/on-update), `image_url`, `cad_file_url`.
- **`users`**: `id`, unique `username`/`email`, `hashed_password`, `team_id` (nullable string, not FK-enforced), `role` (default `"member"`, unused), `is_active`, `created_at`.

No relationship table for team membership beyond a flat `team_id` string on `users` — a team is just a shared string value, not its own entity/table.

## Features
**Parts ordering / inventory (area 5)**
- Public parts catalog CRUD: create/list/get/update/delete (`app/main.py` "PUBLIC COMPONENTS" section, backed by `app/crud.py`).
- Full-text-ish search/filter over the catalog: `q` (name/description/id substring via `ILIKE`), `category`, `vendor`, `min_cost`/`max_cost`, `availability`, `has_cad_files`, `has_images` — all combined with `AND` (`GET /public-components/search`, `crud.search_public_components`).
- Per-team inventory CRUD, always team-access-checked: create/get/list/update/delete team components (`app/main.py` "TEAM COMPONENTS" section).
- Team component can link to a public catalog entry via `public_component_id`, letting a team "add to inventory" from the shared parts list while overriding name/vendor/quantity/location/notes locally.
- Inventory summary per team: total item count (sum of quantities) and unique-component count (`GET /teams/{id}/inventory/summary`, `crud.get_team_inventory_summary`).
- Facet/utility endpoints for building filter UIs: distinct `/categories`, `/vendors`, `/availability-statuses` (`crud.get_categories` etc., using `SELECT DISTINCT`).
- "Has CAD files" / "has images" filtering both globally and per-team (`/components/with-cad-files`, `/components/with-images`, `/teams/{id}/components/with-cad-files`, `/teams/{id}/components/with-images`).

**Part design/manufacturing tracking (area 6, marginal)**
- Each catalog/team component carries an optional `cad_file_url` — just a link field, no versioning, no file storage, no design review workflow.
- Image attachment for team components: `POST /teams/{team_id}/components/{component_id}/add-image` sets/updates a component's `image_url`; `POST /teams/{team_id}/add-image` creates a synthetic team_components row purely to hold a "team image" (a hacky way to attach a general team photo since there's no dedicated team-media table).

## Integrations
None. No Slack/Discord/email/Onshape/TBA integration. Images/CAD are just user-supplied URL strings (presumably pointing at external CDNs); the API itself does no file upload/storage.

## Notable Implementation Details
- Uses the async `databases` library + SQLAlchemy Core (not the ORM) — raw `Table`/`select()`/`insert()` query-builder style throughout `crud.py`. Simple to read, but no session/transaction management shown beyond single statements.
- `update_*` functions filter out `None` values before building the `UPDATE ... values()` call, which is a reasonable pattern for "PATCH-like PUT with partial payload" — but it also means a client can never explicitly null out a nullable field.
- Team image "component" hack (`create_team_image`): reuses the `team_components` table with placeholder `name="Team {id} Image"`, `vendor="Team Upload"`, `quantity=1`, `location="Digital/CDN"` to store what is really just an image URL. Symptom of the schema lacking a dedicated media/attachments table — a re-implementation should give team media its own table instead of overloading inventory rows.
- Public-component write endpoints are unauthenticated — a real gap if this schema/idea is reused; any re-implementation should require at least admin auth for catalog mutation.
- SQLite as the only supported DB in the shown code (`DATABASE_URL` defaults to a local `sqlite:///./frc_components.db`); the checked-in `frc_components.db` file in the repo root suggests the dev DB itself may have been committed (a data-hygiene anti-pattern worth avoiding).
- No tests, no migrations tooling, no seed script other than the checked-in DB (there is a `data.csv`, likely used to seed the ~46 public parts, but it's not read by any code in the tree — pipeline undocumented).
- No pagination on any list endpoint (`get_all_public_components`, `get_team_components`, etc.) — fine at "46+ parts" scale, would not hold up for large team histories.

## Verdict
Thin but concretely relevant to area 5: a small, single-developer FastAPI project with a real public-parts-catalog + team-inventory split and useful filter/facet endpoints, but missing genuine purchase-order/vendor-order workflow, no role enforcement, and public-catalog writes are unintentionally open. Worth stealing: the public-catalog vs. team-inventory-with-optional-link data shape, and the categories/vendors/availability facet endpoints for a parts browser UI; not worth stealing the auth gaps or the "image as fake inventory row" hack.
