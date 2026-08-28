# Parts, projects, and the shop dashboard

Team Hub tracks every manufactured part through a numbered, project-scoped manufacturing pipeline
— a hub port of cheesy-parts' status model. Students and mentors manage parts in the admin pages;
the shop floor watches live status on a TV-style dashboard; and an Onshape right-panel lets anyone
CADing a part add it to the hub without leaving Onshape.

## Projects and parts

A **project** (`/admin/projects`) is a numbering namespace with a short prefix (e.g. `RA2026`).
Every part and assembly belongs to exactly one project and gets a sequential **part number**
formatted as `{prefix}-{P|A}-{00000}` (`fullPartNumber()` in `src/lib/types.ts`).

- **Assemblies** are self-referencing (`parent_part_id` FK on `part`), so a project's part tree can
  nest arbitrarily. Assembly numbers are allocated in blocks of 1000 (`0, 1000, 2000, …`); a part's
  number is its parent assembly's number + 1, or the next unused number among siblings.
- **Parts** must belong to an assembly — there's no "loose" top-level part — because part numbering
  is seeded from the parent's block (see the comment on `nextPartNumber()` in
  `src/lib/parts.ts`). Assemblies may themselves be top-level or nested.
- Numbering and insert aren't transactional; a `part_number` unique-violation from two concurrent
  creates triggers one retry, then a 409.

Each part carries a 22-status manufacturing pipeline (`PART_STATUSES` in `src/lib/types.ts`):
`designing` → `material`/`ordered` → `drawing` → `drawing_done` → `mentor_approved` → `ready` →
a manufacturing-process status (`cnc`, `laser`, `mill`, …) → `outsourced`/`welding`/finishing
statuses → `assembly` → `done`. `drawing_done` and `mentor_approved` are hub-local additions to the
cheesy-parts status list, giving a checkpoint before a part is released to the shop. Each status
also has a `STATUS_TONE` (`design` / `blocked` / `ready` / `working` / `done`) that drives the
board's color coding.

Pages and APIs:

- `/admin/projects` (mentor+) — list projects, part counts, create new.
- `/admin/projects/[id]` (student+ view, mentor+ edit) — part table (sortable), new-part form,
  delete.
- `/admin/parts/[id]` (student+ view, edit via `PartEditForm`) — full part detail, breadcrumb of
  assembly ancestors, child parts if it's an assembly.
- `POST /api/admin/projects`, `PUT`/`DELETE /api/admin/projects/[id]` (mentor+).
- `POST /api/admin/parts`, `PATCH`/`DELETE /api/admin/parts/[id]` (student+ — any logged-in student
  can update part status/notes/material from the shop floor; only mentors manage projects).
- Source: `src/lib/parts.ts` (CRUD + validation + numbering), `src/lib/types.ts` (status/priority
  maps, row↔domain mappers).

Deleting a project or an assembly is refused (409) while it still has parts/children — the FK
`RESTRICT` is the backstop, but `deleteProject`/`deletePart` check first so the error is a clean
409 rather than a raw DB error.

## Shop dashboard

`/shop` (student+) lists projects; `/shop/[projectId]` shows that project's parts grouped by status
as a kanban-style board (`ShopBoard.tsx`), sorted by priority then part number within each status
column. It's meant to run unattended on a shop TV: the server renders the initial parts list, then
the client board polls `GET /api/shop/[projectId]` every 10 seconds and keeps the last good data on
a failed poll instead of blanking. A status filter (`?status=`) narrows the board to one column; by
default `done` parts are hidden. Tiles link to `/admin/parts/[id]` for detail/edit.

## Onshape panel

`/onshape` is the iframe Onshape loads as a right-panel action inside a Part Studio — it shows the
CAD parts in the currently-open element and lets a student link one to a hub part in one step.
`/onshape/connect` is the companion popup that links a hub account to Onshape via OAuth.

**Why a separate auth path:** the panel iframe runs on `onshape.com`, so normal hub session cookies
never reach it. Instead:

1. The panel (`OnshapePanel.tsx`) opens `/onshape/connect` as a popup. That page runs top-level (on
   the hub origin), so normal hub cookies work there.
2. `/onshape/connect` mints a long-lived (90-day) **panel bearer token** (`src/lib/onshape-panel-
   token.ts`, a signed JWT scoped with `kind: "onshape-panel"`) and posts it back to the iframe via
   `postMessage`. The iframe caches it in `localStorage` (survives the reload Onshape does on every
   CAD selection change) and sends it as `Authorization: Bearer <token>` on its own API calls.
3. `getViewer()` (`src/lib/viewer.ts`) accepts this bearer token as a third identity source
   alongside the Supabase session and the student QR/link token — it re-checks `is_active`/role
   from the DB on every request, so removing someone from the roster revokes panel access
   immediately even though the token itself doesn't expire for 90 days.
4. If the hub account isn't yet linked to Onshape, `/onshape/connect` redirects through
   `GET /api/onshape/oauth/{start,callback}` (the OAuth2 authorization-code flow against
   `oauth.onshape.com`, with a single-use `state` cookie for CSRF) before closing itself and
   signaling the iframe to reload.

Once connected, the panel calls `GET /api/onshape/panel/context` with the CAD selection (document,
workspace/version, element) as query params — Onshape leaves any param it can't fill in as a
literal `{$paramName}` token, which `discardOnshapeToken()` strips. The route:

- Fetches the element's parts from the Onshape API (`listElementParts()` in `src/lib/onshape.ts`),
  refreshing the stored OAuth token if needed (one retry on a 401/403, then `needs_reconnect`).
- Matches each CAD part to a hub part by its Onshape identity triple (document + element + part
  id) via `findPartByOnshapeIdentity()`.
- For an already-linked part, the panel shows its hub part number with an inline status dropdown
  (`PATCH /api/admin/parts/[id]`, same bearer token).
- For an untracked part, an inline **Add** form posts to `POST /api/onshape/panel/parts`, which
  validates the Onshape linkage fields (`parseOnshapePartInput`) and calls the same `createPart()`
  used everywhere else — a duplicate identity triple (`part_onshape_identity_unique`) is rejected
  with 409.

A dev-only mock of the Onshape OAuth token endpoint and parts API lives under
`src/app/api/dev/onshape-mock/`, gated by `onshapeMockBlocked()` (`gate.ts`) — it checks the
unforgeable `VERCEL_ENV` first, so it can never be reachable on a real Vercel deployment (prod or
preview), and requires an explicit `ALLOW_ONSHAPE_MOCK=1` opt-in for non-Vercel production-mode
runs (e.g. CI e2e).

For OAuth app registration and required environment variables, see
[docs/setup/onshape.md](../setup/onshape.md).

## Caveats

- The panel's `/api/onshape/panel/context` route does one `listParts()` per project on every
  request (Onshape reloads the panel on every CAD selection change) — fine at team scale, but an
  N+1 that would need batching if project count grew a lot.
- A `server` query param from Onshape is only trusted if it resolves to an `onshape.com` host
  (`normalizeServer()`); anything else falls back to the configured API base, so a spoofed `server`
  can't redirect API calls off-origin.
- The Onshape client ID has a vendor quirk: every literal `0` in the configured client ID must be
  sent as `O` (`clientId()` in `src/lib/onshape.ts`).
