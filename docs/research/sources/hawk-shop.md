# hawk-shop — Source Survey

**Repo:** https://github.com/FRC2713/hawk-shop (FRC 2713, Hawaiian Robotics)
**Surveyed at commit:** `59fc21726cda6a520adff123bb26b7c319952655`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/FRC2713/hawk-shop/blob/59fc21726cda6a520adff123bb26b7c319952655/<path>`

## Purpose

hawk-shop is a self-hosted manufacturing-workflow tracker: parts are browsed live from an
Onshape Part Studio, "released" onto a kanban board, and tracked through a shop's manufacturing
process (CNC, 3D printing, hand tooling, etc.) until done. It is explicitly a single-container,
SQLite-backed fork of an earlier sibling project, **rhr-mfg** (same team), which used Next.js +
Supabase Postgres/Realtime/Storage on Vercel — hawk-shop swaps those for Drizzle/SQLite, local
file storage, and server-sent events so the whole thing runs as one Docker container + one volume
on a shop-floor box with no external services. Covers only the design-manufacturing area of team
operations; there is no attendance, roster, purchasing, or general-communication feature.

## Stack

- **Language:** TypeScript throughout (app + build tooling).
- **Framework:** TanStack Start (file-based routes under `app/routes/`, React 19), built on Vite;
  server route handlers live beside pages in the same route tree (`app/routes/api/**`).
  `README.md`, `app/start.ts`, `app/router.tsx`.
- **Database:** SQLite via Drizzle ORM. Schema in `app/lib/db/schema.ts`; a single migration file
  `drizzle/0000_nosy_proteus.sql` is applied automatically on boot by `scripts/migrate.ts`. No
  Postgres, no external DB.
- **UI:** Tailwind CSS + shadcn/ui component set (`app/components/ui/*`), TanStack Query for data
  fetching/caching, `lucide-react` icons, `date-fns` for dates, drag-and-drop kanban board.
- **Auth:** Onshape OAuth2 only — no local accounts, no password login, no team-defined roles.
- **File storage:** Local filesystem under `DATA_DIR/uploads`, served through `/api/files/*`
  (`app/lib/storage/files.ts`), replacing Supabase Storage buckets.
- **Real-time updates:** An in-process event bus (`app/lib/events/bus.ts`) fanned out over
  server-sent events (`app/routes/api/kanban/events.ts`), replacing Supabase Realtime.
- **License:** none found. No `LICENSE`/`COPYING` file at the repo root and no `license` field in
  `package.json` — all rights reserved by default; flagged per the survey brief.
- **Deployment:** Single `Dockerfile` + `docker-compose.yml`; one named volume (`hawk-shop-data`)
  holds both the SQLite file and uploaded images, so "back up `DATA_DIR`" backs up the whole
  install. Healthcheck hits `/api/health`. No CI config found in the repo tree explored.
- **Last activity / status:** Most recent commit at the surveyed pin is dated 2026-08-11 (per
  `git log`) — actively developed, not abandoned; the README frames it as the deliberately
  simplified, dependency-free alternative to the team's own earlier Supabase-based tool.

## Auth & Roles

- **No role system.** Any user who completes Onshape OAuth is treated identically — every DB-backed
  API route (`/api/kanban/*`, `/api/equipment/*`, `/api/processes/*`, `/api/users/*`) is gated only
  by `requireAuth()` (`app/lib/requireAuth.ts`), which checks for a valid Onshape session and
  nothing else. A code comment there notes this was a fix: these routes previously answered *any*
  caller on the network, reads and writes alike, until `requireAuth` was added.
- **Global request gate** (`app/start.ts`) — a TanStack Start request middleware redirects any
  non-public, non-API page request without a usable Onshape session to `/auth/onshape`, carrying
  the original path to return to. `/signin` and `/auth/*` are public; static assets are excluded;
  `/api/*` and `/_serverFn/*` are deliberately let through the middleware because their handlers
  re-verify themselves (this is where `requireAuth()` matters).
  Historical note in the comments: an old `?auth=success` bypass (a forgeable query param that
  skipped the check) has been removed.
  `app/start.ts`.
- **OAuth flow & tokens** — `app/routes/auth/onshape.index.ts`, `app/routes/auth/onshape.callback.ts`,
  `app/lib/onshapeAuth.ts`, `app/lib/onshapeAuthRequest.ts`. Access/refresh tokens and expiry are
  stored in `httpOnly` cookies (30-day max age), with a separate short-lived (10 min) OAuth-state
  cookie for CSRF protection during the redirect round trip. `ONSHAPE_IFRAME_EMBED=true` switches
  cookies to `SameSite=None; Secure` for embedding hawk-shop inside Onshape's own iframe (requires
  HTTPS); otherwise `SameSite=Lax` for plain LAN use.
- **User records** — a `users` table (keyed by `onshape_user_id`) is upserted on login purely to
  drive a "who's on the team" list (`app/components/users/UsersList.tsx`,
  `app/routes/api/users.index.ts`, `app/lib/db/users.ts`); it carries no permission field.
- **Token refresh concurrency guard** — `requireAuth()` deliberately does *not* attempt to refresh
  an expiring token itself, because Onshape rotates the refresh token on use and a board view fires
  many parallel API calls; refresh is centralized in the `/auth/onshape` redirect path so only one
  request can drive rotation at a time (documented in the file's comments,
  `app/lib/tokenRefresh.ts`).

## Data Model

(`app/lib/db/schema.ts`, Drizzle/SQLite)

- **users** — `onshape_user_id` (PK, text), `name`, `created_at`, `updated_at`. No role/permission
  column.
- **processes** — `id` (PK), `name` (unique), `description`. Nine rows are seeded on first boot
  (`SEED_PROCESSES`: CNC Milling, 3D Printing, Hand Tooling, Measuring, Power Tooling, Safety
  Equipment, Fastening, Material Processing, Other).
- **equipment** — `id` (PK), `name`, `description`, `location`, `status`, `documentation_url`,
  `image_urls` (JSON array).
- **equipment_processes** — join table (`equipment_id`, `process_id`), composite PK, cascade
  delete both ways — which manufacturing processes a piece of equipment supports.
- **kanban_cards** — the manufacturing-tracker card for one released part: `id` (PK), `column_id`
  (references a column *by id string*, not a FK — see below), `title`, `image_url`, `assignee`,
  `date_created`, `date_updated`, `machine`, `due_date`, `content`, `created_by`,
  `quantity_per_robot`, `quantity_to_make`, plus six `onshape_*` fields
  (`document_id`/`instance_type`/`instance_id`/`element_id`/`part_id`/`version_id`) that pin the
  card back to the exact Onshape part/version it was released from. Indexed on `column_id` and
  `date_created`.
- **kanban_card_processes** — join table (`card_id`, `process_id`) linking a card to the processes
  it requires, cascade delete.
- **kanban_config** — a single JSON blob (`columns: KanbanColumn[]`) holding the board's column
  list; columns are *deliberately not a relational table* — a card's `column_id` is just a string
  that must match one of these ids. Default columns (`app/lib/kanbanApi/columnTypes.ts`): Backlog,
  In Progress, Review, Done.
- **part_thumbnails** — cache of Onshape-rendered part thumbnails copied to local disk: composite
  PK (`document_id`, `instance_type`, `instance_id`, `element_id`, `part_id`), `storage_path`
  (relative to the uploads dir), `source_url` (indexed, used as the cache lookup key).

Note: parts themselves are **not** stored in this schema at all — the "part" side of a kanban card
is fetched live from Onshape on every page load (`app/lib/onshapeApi/*`, `app/routes/api/onshape/*`)
and joined client-side to the locally-stored `kanban_cards` row by part number/version. Only the
kanban/manufacturing state is persisted locally.

## Features

- **Onshape Part Studio browser** — Given `documentId`/`instanceType`/`instanceId`/`elementId`
  query params (an Onshape Part Studio URL), lists every part in that studio with thumbnail,
  material, appearance/color, and part number, live from the Onshape API.
  `app/onshape_connector/parts-client.tsx`, `app/onshape_connector/hooks/usePartsData.ts`,
  `app/routes/api/onshape/parts.ts`, `app/routes/onshape_connector.tsx`.
- **Card/list view toggle, search, and sort** — Toggle between a card grid and a compact list;
  free-text search over part name/number; sort by name or manufacturing state.
  `app/onshape_connector/parts-client.tsx`, `app/onshape_connector/hooks/usePartsSearch.ts`,
  `app/onshape_connector/hooks/usePartsSort.ts`, `app/onshape_connector/OnshapeConnectorToolbar.tsx`.
- **Hide already-released parts** — Toggle to filter out parts that already have a matching kanban
  card. `app/onshape_connector/parts-client.tsx` (`hideReleased`).
- **Part eligibility gating** — A part can only be released if it has a material set and a part
  number set in Onshape, and is not already tracked; the UI explains which condition failed.
  `app/onshape_connector/utils/partEligibility.ts`, `app/components/mfg/PartMfgState.tsx`.
- **Release one part to manufacturing** — Dialog to pick manufacturing processes, quantity per
  robot, quantity to make, and an optional due date; posts to the shared
  `/api/mfg/parts/actions` (`action=addCard`) endpoint, which snapshots the Onshape coordinates
  (document/instance/element/part/version id) onto the new card and caches its thumbnail locally.
  `app/components/mfg/AddCardDialog.tsx`, `app/components/mfg/PartMfgState.tsx`,
  `app/onshape_connector/actions/kanbanOperations.ts` (`handleAddKanbanCard`),
  `app/lib/api/partActions.ts` (`addCard`).
- **Bulk release** — Multi-select parts (click, shift-click range, ctrl/cmd-click) across the
  studio browser, then release all eligible selections at once with shared processes/due date but
  per-part quantities; reports per-part success/failure.
  `app/onshape_connector/parts-client.tsx` (`handleBulkRelease`),
  `app/components/mfg/BulkReleaseDialog.tsx`.
- **Kanban board** — Column-per-manufacturing-state board (configurable columns, default
  Backlog/In Progress/Review/Done); drag a card between columns to update its state; live-updates
  across viewers over an SSE stream rather than polling.
  `app/components/app/kanban-client.tsx`, `app/routes/api/kanban/cards.$id.ts` (`moveCard`),
  `app/routes/api/kanban/events.ts`, `app/components/kanban/KanbanRealtimeSubscriber.tsx`,
  `app/lib/kanbanApi/useKanbanRealtime.ts`.
- **Card assignment** — Assign a person (free-text name from the known users list) to a card.
  `app/routes/api/kanban/cards.$id.assign.ts`.
- **Due dates** — Set/clear a due date on a card; overdue/upcoming styling.
  `app/components/mfg/PartDueDate.tsx`, `app/lib/api/partActions.ts` (`updateDueDate`).
- **Configurable board columns** — Admins (any authenticated user — no extra gate) can add/rename/
  reorder/remove manufacturing-state columns; stored as one JSON blob rather than rows.
  `app/routes/api/kanban/config.columns.ts`, `app/routes/api/kanban/config.index.ts`,
  `app/lib/kanbanApi/config.ts`.
- **Done view** — Separate page listing completed cards, split out of the live board.
  `app/routes/_main.kanban.done.tsx`, `app/components/app/done-client.tsx`.
- **Part number edit-back to Onshape** — Update a part's number directly from hawk-shop, written
  back into the Onshape document via the API (not just stored locally).
  `app/onshape_connector/actions/partNumberUpdate.ts`, `app/components/mfg/PartNumberInput.tsx`.
- **Manufacturing process catalog** — Manage the list of named processes (CNC, 3D printing, etc.)
  used to tag both equipment and kanban cards. `app/routes/api/processes.index.ts`,
  `app/routes/api/processes.$id.ts`, `app/lib/processesApi/processes.ts`.
- **Equipment registry** — Track shop equipment: name, description, location, status,
  documentation link, one or more images, and which manufacturing processes it supports.
  `app/routes/api/equipment.index.ts`, `app/routes/api/equipment.$id.ts`,
  `app/routes/api/equipment.$id.image.ts`, `app/components/app/equipment-client.tsx`,
  `app/lib/equipmentApi/equipment.ts`, `app/lib/equipmentApi/images.ts`.
- **Thumbnail caching** — Onshape part thumbnails are fetched once and cached to local disk keyed
  by document/instance/element/part id, served back from `/api/files/*` on subsequent loads instead
  of re-hitting Onshape. `app/routes/api/onshape/thumbnail.ts`, `app/lib/storage/files.ts`.
- **Team roster / who's signed in** — Simple list of users who have ever authenticated, keyed by
  Onshape user id and display name. `app/components/users/UsersList.tsx`,
  `app/routes/api/users.index.ts`, `app/routes/api/users.$id.ts`.
- **Health check** — `/api/health` used by the Docker healthcheck. `app/routes/api/health.ts`.
- **Sign-in page** — Single "Sign in with Onshape" button; no local credential form exists.
  `app/routes/signin.tsx`, `app/components/app/signin-client.tsx`.

Not present: no attendance tracking, no purchasing/order tracking, no general team communication
feature, no roster beyond "users who have logged in", no CSV/spreadsheet export, no audit log, no
role-based permissions.

## Integrations

- **Onshape API (OAuth2 + REST)** — the entire reason the app exists: browsing Part Studios,
  reading part metadata (material, appearance, part number), fetching thumbnails, fetching version
  names, and writing part numbers back. A generated API client wraps Onshape's OpenAPI spec.
  `app/lib/onshapeApi/client.ts`, `app/lib/onshapeApi/generated/`, `app/lib/onshapeApi/auth.ts`,
  `openapi-ts.config.ts`.
- **Onshape iframe embedding** — can run *inside* an Onshape document as a custom integration
  ("Onshape Connector"/toolbar) rather than only as a standalone site; requires HTTPS and the
  `ONSHAPE_IFRAME_EMBED` cookie mode. `app/onshape_connector/OnshapeConnectorToolbar.tsx`,
  `README.md`.
- No email, chat, or other third-party integrations found.

## Notable Implementation Details

- **Deliberate simplification vs. its own predecessor.** hawk-shop is explicitly a rewrite of the
  same team's Supabase/Vercel tool (`rhr-mfg`) to remove every external dependency: Postgres →
  SQLite, hand-applied migrations → `drizzle-kit` auto-applied on boot, Supabase Storage → local
  files under one volume, Supabase Realtime → an in-process event bus + SSE. The README's
  comparison table is effectively the project's own design rationale. `README.md`.
- **Cross-reference to kanshape.** Both hawk-shop and `wave-2826/kanshape` (surveyed separately,
  `docs/research/sources/kanshape.md`) solve the same problem — an Onshape-integrated kanban board
  for releasing CAD parts into manufacturing — but diverge sharply in approach: hawk-shop is
  TypeScript/React/TanStack Start with a relational SQLite schema (typed columns per concern:
  cards, processes, equipment, thumbnails) and OAuth-only identity with no role system; kanshape
  (see that survey) is Svelte-based and MIT-licensed, where hawk-shop carries no license at all.
  A reimplementation drawing from both should note hawk-shop's part-eligibility gating (material +
  part number required before release) and its "snapshot the Onshape coordinates onto the card"
  pattern as the more defensible pieces to imitate, given its unclear license status.
- **Auth middleware trusts route handlers, and one handler class used to fail that trust.**
  `app/start.ts`'s comment block documents that `/api/*` requests are intentionally passed through
  the top-level redirect gate on the assumption each handler re-verifies auth — and that this was
  previously *not* true for the DB-backed routes (kanban/users/equipment), which is why
  `app/lib/requireAuth.ts` exists as an explicit, separately-added check. A reimplementation should
  not assume "there's a global auth middleware" is sufficient without auditing every handler.
  `app/start.ts`, `app/lib/requireAuth.ts`.
- **Non-transactional part→card matching.** A released part is matched back to its Onshape source
  by a composite key of `partNumber::versionId` with a fallback to bare `partNumber` "for backward
  compatibility with old cards" — i.e., the matching key changed shape at some point in the
  project's history and both forms must still be handled client-side.
  `app/onshape_connector/utils/versionUtils.ts`, `app/onshape_connector/parts-client.tsx`.
- **Kanban columns are configuration, not rows.** Storing columns as one JSON document
  (`kanban_config`) rather than a table means adding/renaming a column is a single-row update with
  no migration, but referential integrity between `kanban_cards.column_id` and a valid column id is
  enforced only in application code, never by the database. `app/lib/db/schema.ts` (comment on
  `KanbanColumnConfig`).
- **SSE instead of polling or WebSockets.** The realtime replacement is a single `/api/kanban/events`
  stream with a 25s heartbeat comment-frame (to survive proxy idle-timeouts) and an in-process
  pub/sub bus — simple, but means realtime only works within one server process/container; there is
  no fan-out across multiple app instances. `app/routes/api/kanban/events.ts`,
  `app/lib/events/bus.ts`.
- **Refresh-token stampede avoidance.** Per-request auth checks deliberately never trigger a token
  refresh themselves, to avoid concurrent requests racing to rotate (and invalidate each other's)
  the Onshape refresh token; refresh is centralized behind a single redirect route.
  `app/lib/requireAuth.ts`, `app/lib/tokenRefresh.ts`.
