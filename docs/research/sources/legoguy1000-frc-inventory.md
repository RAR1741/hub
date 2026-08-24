# FRC-Inventory — Source Survey

**Repo:** legoguy1000/FRC-Inventory — https://github.com/legoguy1000/FRC-Inventory
**Surveyed-at:** 09bc9a1ec53cff2fed3371e2134759280439fe36
**Permalink form:** https://github.com/legoguy1000/FRC-Inventory/blob/09bc9a1ec53cff2fed3371e2134759280439fe36/<path>
**Stack:** Express + TypeScript backend, Prisma + PostgreSQL 17, React + Vite (MUI-based dashboard template) frontend, Docker Compose deploy (`Dockerfile.server`, `Dockerfile.web`, nginx for the web image)
**License:** none — no LICENSE file in the repo tree (`license: null` in the GitHub API repo record); `server/package.json` sets `"license": "ISC"` for the npm package metadata only, which does not substitute for a repo license. Ideas only, no code reuse.
**Last activity:** 2025-02-05 (pushed_at 2025-02-05T20:58:39Z); repo created 2025-01-10. Appears dormant (no pushes since; 4 open issues, 0 stars/forks).
**FRC team:** unknown (no team number found in README, code, or config; author handle "legoguy1000" not otherwise identified)
**Areas:** (6) part design/manufacturing tracking — actually more of a general hardware/part inventory + project-assignment tracker than a manufacturing-status tracker (no per-part build stages); (5) parts ordering/POs — partial (part catalog + CSV export, no PO/ordering workflow)

## Purpose
A small inventory-management tool for tracking physical robot parts (e.g. motor controllers, sensors) as a catalog ("Part" = a distinct vendor+name SKU) separately from individual physical units of that part ("Inventory" = one purchased instance, with a purchase date, optional retirement date, notes/status, and optional assignment to a "Project"). Projects are lightweight buckets (e.g. "2025 robot", "practice bot") that inventory items can be checked out to. Very early-stage/prototype: the dashboard UI is a mostly-unmodified MUI dashboard template, and the root `GET /` route still contains leftover demo/seed code that creates a hardcoded user/part/project/inventory row on every hit.

## Auth & Roles
None functionally. `web/src/pages/Login.tsx` renders a plain username/password `<form>` with no `onSubmit` handler (submitting does nothing). `web/src/Services/AuthService.ts` is a stub: `isLoggedIn()` unconditionally `return false`. The Express server (`server/src/index.ts`) has no auth middleware at all — every route is open. There is a `User` Prisma model (`id`, `first_name`, `last_name`) but no route ever reads/writes it except the leftover demo code in `index.ts`; it is not wired to login or to any permission check.

## Data Model
Prisma schema at `server/src/prisma/schema.prisma`:
- `User` — id (uuid), first_name, last_name, timestamps. Unused by any route; vestigial.
- `Part` — id (uuid), vendor, name, category (default `"other"`), location, image_url, website, timestamps; `@@unique([vendor, name])`. Represents a catalog SKU, not a physical unit.
- `Project` — id (uuid), name, owner (optional free-text string, not an FK to `User`), retired (bool), timestamps.
- `Inventory` — id (uuid), purchased (DateTime), retired (DateTime, optional), notes, status (free-text string, optional), partId (FK → Part, `onDelete: Restrict`), projectId (FK → Project, optional, `onDelete: Restrict`), timestamps. Represents one physical purchased unit, optionally checked out to a project.

## Features
**Part catalog** (`server/src/routes/parts.ts`)
- CRUD on parts with vendor+name uniqueness enforced case-insensitively on create and update
- Bulk part creation via `POST /parts/bulk` — accepts an array, creates each independently and returns a per-row success/error array (not transactional)
- CSV export of the full part catalog via `GET /parts/export` (`@json2csv/node`), streamed as a file download
- Distinct-value lookups `GET /parts/categories` and `GET /parts/locations` for populating filter/autocomplete UI
- Delete guarded against parts that still have inventory rows referencing them

**Projects** (`server/src/routes/projects.ts`)
- CRUD on projects with name uniqueness; `owner` is a plain optional string field, not a user reference
- Project list includes an inventory `_count` for a quick per-project item tally
- `GET /projects/:id/inventory` returns parts joined to only that project's inventory rows (i.e. "what's checked out to this project")
- Delete guarded: a project can't be deleted while any inventory is still assigned to it (must unassign first)

**Inventory** (`server/src/routes/inventory.ts`)
- Single `GET /inventory` endpoint returning all inventory rows with their `part` and `project` relations included — no create/update/delete route exists yet (likely handled through the `parts`/`projects` nested paths or unimplemented at this commit)

**Frontend** (`web/src/pages/`: `Dashboard.tsx`, `Login.tsx`, `inventory/Inventory.tsx`, `parts/Parts.tsx` + `parts/Part.tsx`, `projects/Projects.tsx`) — a React/Vite app built on an MUI admin-dashboard starter template (components include `ChartUserByCountry`, `PageViewsBarChart`, `SessionsChart`, `StatCard` — all template boilerplate not customized to this domain at the surveyed commit). `web/src/Services/` holds one service module per resource (`PartService.ts`, `ProjectService.ts`, `InventoryService.ts`, `NavigationService.ts`) plus the non-functional `AuthService.ts`.

## Integrations
None. No CAD tool, vendor API, Slack/Discord, or SSO integration present anywhere in the codebase.

## Notable Implementation Details
- **Catalog/instance split is the one clear reusable idea**: separating "what kind of part" (`Part`, unique per vendor+name) from "which physical unit we own" (`Inventory`, one row per purchased item with its own purchase/retirement dates and project assignment) is a clean, worth-copying model for teams that buy multiples of the same SKU and need to track individual units' lifecycle/checkout state separately from the catalog entry.
- `Inventory.status` and `Project.owner` are untyped free-text strings with no enum/FK backing — any recreation should decide deliberately whether to keep it that loose or add real enums/relations.
- Root route (`GET /`) still runs leftover Prisma seed/demo code on every request (creates a user, part, project, and inventory row) rather than being a real health-check or index route — a sign of very early/prototype status, not a pattern to copy.
- Delete-guard pattern (`onDelete: Restrict` in Prisma plus an app-level pre-check that returns a 400 instead of a DB error) is used consistently for both `Part` and `Project` deletion — a decent lightweight referential-integrity pattern for small internal tools without needing cascade logic.
- Bulk-create endpoint processes rows sequentially and reports partial success/failure per row rather than wrapping the batch in a transaction — acceptable for a low-volume internal tool but not atomic.

## Verdict
Thin and clearly early-stage/abandoned (single week of commits, no activity since Feb 2025, auth entirely stubbed out, UI still template boilerplate) — not directly reusable as a feature reference beyond the catalog-vs-instance inventory split, which is a genuinely useful pattern for a parts/inventory catalog feature. Low priority for the catalog; worth a one-line mention for that one modeling idea rather than deep study.
