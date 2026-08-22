# frc-parts (SpikeParts) — Source Survey

**Repo:** PillageDev/frc-parts — https://github.com/PillageDev/frc-parts
**Surveyed-at:** b5619ee448f9ed3486a8ba6e68ad203170f9a311
**Permalink form:** https://github.com/PillageDev/frc-parts/blob/b5619ee448f9ed3486a8ba6e68ad203170f9a311/<path>
**Stack:** Next.js 16 (App Router, Turbopack) + TypeScript, tRPC v11, Drizzle ORM on SQLite (`better-sqlite3`), better-auth, Tailwind v4 + shadcn/ui (Radix primitives), Onshape REST API v6 (HMAC-signed)
**License:** none — no LICENSE file, `package.json` marked `"private": true`, no license header in source. Ideas only, not reusable code.
**Last activity:** 2026-05-10 (pushed_at; actively developed)
**FRC team:** unknown (no team number/name found in README, AGENTS.md, or source; repo owner handle is "PillageDev")
**Areas:** part design/manufacturing tracking (primary); touches third-party integrations (Onshape)

## Purpose

"SpikeParts" bills itself as "a manufacturing OS for robotics teams." It imports parts and assemblies live from Onshape CAD, auto-routes custom (non-COTS) parts to a shop machine queue based on material/geometry heuristics, tracks per-part manufacturing operations (multi-step routing with per-step status/estimates/actuals), flags design-changed revisions when Onshape microversions bump, and gives each shop machine its own Kanban-style queue dashboard. It targets the fabrication side of an FRC team (CNC/waterjet/3D-print/manual shop), not robot code or scouting.

## Auth & Roles

- **better-auth** with a Drizzle SQLite adapter (`src/lib/auth/server.ts`), email+password sign-in/sign-up (`autoSignIn: true`), 30-day sessions.
- `user.role` enum: `designer | lead | manufacturer | admin` (`src/lib/db/schema.ts`), default `designer` — but this is a schema-level field only. Every tRPC procedure discovered in `parts.ts` and `assemblies.ts` is declared as `publicProcedure` (`src/lib/trpc/init.ts` / routers) — **no role-gating or session-check middleware was found wired into the routers**, so the role column appears aspirational/unused at the API layer as of this commit.
- Notable gotcha: `src/lib/auth/server.ts` ships a **hardcoded fallback `secret`** (a static hex string) used whenever `BETTER_AUTH_SECRET` is unset, with a comment warning production must override it. Fine for a demo, a real anti-pattern to copy as-is.

## Data Model

Drizzle/SQLite schema (`src/lib/db/schema.ts`), all IDs are prefixed nanoids via `src/lib/id.ts` (`createId("prt")` etc.):

- **Auth tables** (better-auth managed): `user`, `session`, `account`, `verification`.
- **`machine`** — a shop tool (`kind` enum: cnc_router, cnc_mill, manual_mill, lathe, laser_cutter, 3d_printer, bandsaw, chopsaw, bench, waterjet, outsource), cost/hour, `isOutsource` flag.
- **`assembly`** — an Onshape assembly/BOM root, stores `onshapeDocumentId/WorkspaceId/ElementId/Url` + `lastSyncedAt`; has many `part`.
- **`part`** — the central entity: name, unique `partNumber`, `type` (custom/cots), `status` (ready_to_make/in_production/qc/done/on_robot), `priority` (blocking/high/normal/low), Onshape linkage fields (document/part/element/version/microversion ids, version name, url), geometry (mass, volume, bbox x/y/z), COTS fields (vendor, vendor part #, unit price), `quantity`, `stockType` (references a route template key), optional `folderId`, `batchKey` (batch grouping), `notes`.
- **`folder`** — user-defined subsystem grouping with color/sort order.
- **`routeTemplate`** / **`routeTemplateStep`** — named, ordered manufacturing routes keyed by `stockType` (built-ins: auto/tubing/plate/block/round/print/manual, plus user-defined keys); each step has a preferred `machineId` (nullable-safe) with a `machineKind` fallback, and can `requireFile`/`requireFileKind`/`requireNote` gates before completion.
- **`partRevision`** — one row per Onshape microversion bump, with mass/volume snapshot, `changeSummary`, `flagged` boolean ("design changed" alert).
- **`operation`** — a part's live manufacturing step instance (copied from a route template at import time): sequence, name, `status` (not_started/in_queue/in_progress/qc_check/complete), `actualMinutes`, `autoAssigned`, machine link, `assignedTo` (user), require-file/require-note gates, started/completed timestamps.
- **`attachment`** — file (.gcode/.nc/.dxf/.svg/.stl/.step/.pdf/other) attached to a part or a specific operation, stored as a `url` (data URL for the demo), with uploader.
- Relations wire assembly→parts, part→operations/revisions/attachments/folder, routeTemplate→steps, operation→machine/assignee/attachments.

## Features

**Part design/manufacturing tracking (core area):**
- Live Onshape part import: pulls name, material, mass, volume, bounding box, thumbnail directly from a pasted Onshape document/version/Part-Studio URL — `src/lib/trpc/routers/parts.ts` (`importPart` procedure), `src/lib/onshape/client.ts` (`fetchPartSnapshot`)
- Assembly/BOM sync: flattens a full Onshape assembly (recursing sub-assemblies) into a parts list, auto-splitting COTS vs custom parts — `src/lib/trpc/routers/assemblies.ts`, `src/lib/trpc/routers/parts.ts` (`importAssembly`), `flattenAssemblyParts()` in `src/lib/onshape/client.ts`
- Auto-routing: heuristic `detectStockType()` picks a stock category (tubing/plate/block/round/print) from material name + bounding-box aspect ratios, then a route template (e.g. waterjet for sheet aluminum, 3D-printer for plastic, mill for aluminum blocks) is applied — `src/lib/routing.ts`
- Multi-step operations per part (e.g. CNC Router → Deburr → Tap → Anodize) with per-step status, machine assignment/override, actual minutes, assignee, and completion gates (require attached file / require note) — `operation` table in `src/lib/db/schema.ts`, `src/lib/trpc/routers/parts.ts`
- Auto-derived part status from its operation list (`computePartStatus()`), with `on_robot` treated as a sticky manual-only terminal state — `src/lib/trpc/routers/parts.ts`
- Revision tracking: each Onshape microversion bump creates a `partRevision` row and can flag a "design changed" alert — `partRevision` table, import/re-import logic in `parts.ts`
- Kanban board: drag-and-drop across Needs Design → Ready → In Production → QC → Done → On Robot with optimistic tRPC mutation updates — `src/components/kanban/kanban-board.tsx`, `src/app/(app)/kanban/page.tsx`
- Per-machine dashboard: each of the 9 seeded shop machines gets its own status-column board — `src/app/(app)/machines/[id]/page.tsx`, `src/app/(app)/machines/page.tsx`
- Priority flagging (blocking/high/normal/low, blocking rendered in red) — `src/lib/labels.ts`, `part.priority`
- Batch grouping: tag parts with a shared `batchKey` to run together on a machine — `part.batchKey`, indexed in schema
- File attachments per part or per operation step (.gcode/.nc/.dxf/.svg/.stl/.step/.pdf), stored as data URLs for the demo — `attachment` table, `src/components/parts/add-step-form.tsx`
- Route template editor ("templates" page) for defining/editing built-in or custom manufacturing routes — `src/app/(app)/templates/page.tsx`, `src/lib/trpc/routers/templates.ts`
- Timeline view and dashboard rollups — `src/app/(app)/timeline/page.tsx`, `src/lib/trpc/routers/dashboard.ts`
- Per-part instructions and a guided "run" mode (likely a step-by-step build-floor view) — `src/app/(app)/parts/[id]/instructions/page.tsx`, `src/app/(app)/parts/[id]/run/page.tsx`

**Third-party integrations (secondary area):**
- Onshape HMAC-signed REST v6 client covering documents, versions, elements, parts, mass properties, bounding boxes, metadata, assemblies, thumbnails — `src/lib/onshape/client.ts`
- Onshape "integrated app" right-panel iframe extension (Part Studio/Assembly sidebar inside Onshape itself), using `postMessage` protocol with `applicationInit` handshake and origin validation — `src/app/onshape/sidebar/onshape-bridge.ts`, `src/app/onshape/sidebar/page.tsx`, `src/app/onshape/sidebar/sidebar-client.tsx`
- Server-proxied thumbnails so the Onshape API secret never reaches the browser — `src/app/api/onshape/thumbnail/route.ts`

## Integrations

Onshape (deep: REST v6 HMAC-signed API client + an embeddable Onshape sidebar iframe extension). No TBA, Slack, Discord, email/SMS, or Google integrations found.

## Notable Implementation Details

- **HMAC request signing** for Onshape is implemented from scratch per Onshape's documented spec (`method\nnonce\ndate\ncontentType\npath\nquery\n`, lowercased, HMAC-SHA256 base64) in `src/lib/onshape/client.ts` — a clean reference implementation worth reading if re-implementing Onshape auth, including the nuance that the `Accept` header is *not* part of the signed string and can be overridden post-signing for binary (thumbnail) responses.
- **Thumbnail fallback chain**: tries a documented per-part thumbnail endpoint, then an alternate path form, then falls back to the part's `thumbnailInfo.href` (itself a signed Onshape URL re-routed through the local signer), then finally degrades to the whole-Part-Studio element thumbnail — defensive multi-tier fallback pattern in `onshape.partThumbnail()`.
- **Workspace imports are hard-blocked** — only released Onshape *Versions* can be imported (`importPart`/`importAssembly` reject workspace refs), forcing teams to use Onshape's version/release workflow before parts enter the tracker — enforces a real "released design" gate.
- **Assembly flattening** recurses sub-assemblies via a `(documentId, elementId)` map with a `seen` set to guard cycles — `flattenAssemblyParts()`.
- **Auto-status derivation** for parts folds all operation statuses into a single part status with an explicit sticky-once-set `on_robot` override, a reasonable pattern for "derived state that a human can still force."
- **Everything is a public tRPC procedure** despite better-auth and a `role` enum existing in the schema — if recreating auth/roles as a feature, this repo demonstrates the schema half without the enforcement half; don't copy that gap.
- **Attachments/thumbnails stored as data URLs in SQLite** — explicitly called out in the README as "for the demo," i.e. a scale limit (no object storage), fine to note but not to imitate at any real team scale.
- SQLite via `better-sqlite3` + Drizzle is the whole persistence layer — no Postgres/Supabase; single-writer, single-file DB assumption throughout (schema uses SQLite-specific `unixepoch()` defaults).

## Verdict

Substantive and squarely on-target: a real, actively-developed (May 2026) CAD-to-shop-floor tracker with a genuinely useful Onshape HMAC client, auto-routing heuristic, and multi-step operation/revision model. Worth stealing (as ideas, no license to reuse code): the auto-routing heuristic (`detectStockType`), the released-version-only import gate, the thumbnail fallback chain, and the part-status-derived-from-operations pattern. Worth avoiding: the all-`publicProcedure` routers with an unenforced role column, and the hardcoded auth-secret fallback.
