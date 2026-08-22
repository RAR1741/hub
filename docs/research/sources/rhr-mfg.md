# rhr-mfg — Source Survey

**Repo:** FRC2713/rhr-mfg — https://github.com/FRC2713/rhr-mfg
**Surveyed-at:** c8ad3abde41f796170ca31a7f6555372e577408a
**Permalink form:** https://github.com/FRC2713/rhr-mfg/blob/c8ad3abde41f796170ca31a7f6555372e577408a/<path>
**Stack:** TypeScript, Next.js 16 (App Router), React 19, Tailwind v4 + shadcn/radix UI components, @tanstack/react-query, Supabase (Postgres, `@supabase/supabase-js`), Zod, `@hey-api/openapi-ts`-generated Onshape API client, Docker deploy, hosted on Vercel (`frc2713-basecamp.vercel.app`)
**License:** none (all rights reserved) — `gh api repos/FRC2713/rhr-mfg` returns `"license": null` and no LICENSE file is present in the tree. Ideas only, no code reuse.
**Last activity:** 2026-07-05 (pushed_at); latest commit surveyed dated 2026-03-06
**FRC team:** FRC 2713 (org name, Vercel project name "basecamp")
**Areas:** (6) part design/manufacturing tracking (primary); (3) third-party integrations (Onshape OAuth)

## Purpose
A manufacturing kanban tool that plugs directly into Onshape (CAD) as a browser-extension-style "connector" page: it reads Part Studio parts by document/version, lets a mentor/student flag manufacturing-ready parts and push them onto a kanban board with process tags, quantities, and due dates, then tracks each physical part card through machining stations to "done." A separate module tracks shop equipment (mills, printers, etc.) as inventory with status/location/images.

## Auth & Roles
- Onshape OAuth 2.0 (authorization-code flow) is the *only* auth mechanism — no separate app login/roles model. `app/auth/onshape/route.ts` builds the authorize URL (`getAuthorizationUrl` in `app/lib/onshapeApi/auth.ts`), with CSRF state stored in an httpOnly cookie; `app/auth/onshape/callback/route.ts` exchanges the code for tokens (`exchangeCodeForToken`), stores access/refresh/expiry in httpOnly cookies (`app/lib/onshapeAuth.ts`), and upserts the Onshape user into Supabase (`app/lib/supabase/users.ts::upsertUser`) using the Onshape user id as primary key.
- Token refresh: `app/lib/tokenRefresh.ts` + `getValidOnshapeTokenFromRequest` transparently refresh an expiring access token using the stored refresh token before server-side Onshape API calls.
- No role/permission system found — anyone who can OAuth into Onshape (i.e., has access to the team's Onshape account) can use the app. `users` table (`migrations/001_create_users_table.sql`) only stores `onshape_user_id` + `first_name`, used for attribution (`created_by` on cards), not authorization.
- `app/signin` page and `app/auth/status` page exist as UI entry points for the OAuth flow.

## Data Model
Supabase/Postgres, migration-file-driven (`migrations/001`–`012`, plain numbered `.sql`, no supabase CLI directory structure visible):
- `users` (`001`): `onshape_user_id` (PK), `first_name`; renamed from `first_name`→`name` in `002`.
- `equipment` (`003`): `id`, `name`, `description`, `category` (removed in `008`), `location`, `status`, `documentation_url`, `image_urls` (JSONB array), timestamps.
- `processes` (`004`, seeded `007`): `id`, `name` (unique), `description` — manufacturing process catalog (e.g., mill, laser cut, 3D print).
- `equipment_processes` (`005`): join table, equipment ↔ processes many-to-many (which machines can run which process).
- `kanban_cards` (implied base table, referenced from `006` on): core manufacturing ticket per physical part instance.
- `kanban_card_processes` (`006`): join table, card ↔ process many-to-many with cascade delete and indexes on both FKs.
- `kanban_cards` gains over time: `quantity_per_robot`, `quantity_to_make` (`009`); loses `material` column (`010`); gains Onshape linkage fields `onshape_document_id`, `onshape_instance_type` (w/v/m), `onshape_instance_id`, `onshape_element_id`, `onshape_part_id` (`011`); gains `onshape_version_id` (`012`, backfilled from `onshape_instance_id` when `instance_type = 'v'`) so a card can be uniquely matched by part-number + document-version even across workspace/version/microversion references.
- Card also carries `column_id` (kanban column FK), `assignee`, `machine`, `due_date`, `created_by` (→ `users.onshape_user_id`), `content`/title.

## Features
**Part design/manufacturing tracking (primary area)**
- Onshape Part Studio connector page (`app/onshape_connector/page.tsx`, `parts-client.tsx`) — reads `documentId`/`instanceType`/`instanceId`/`elementId` from the URL query string (designed to be embedded as an Onshape custom toolbar/tab, see `OnshapeConnectorToolbar.tsx`) and lists all parts in that Part Studio via the generated Onshape SDK.
- Part eligibility check for manufacturing release: a part must have a material assigned and a part number, and must not already have a matching kanban card (`app/onshape_connector/utils/partEligibility.ts::isPartEligibleForRelease`).
- "Release to kanban" flow: `app/onshape_connector/actions/kanbanOperations.ts::handleAddKanbanCard` — Zod-validated form (`addCardSchema`) requiring part number, ≥1 process, positive quantity-per-robot and quantity-to-make, optional due date; resolves the Onshape document version id via `extractVersionId` (`utils/versionUtils.ts`) so cards key off `(partNumber, versionId)`; builds a thumbnail URL through a same-origin proxy (`/api/onshape/thumbnail`) to avoid exposing Onshape tokens client-side; stamps `created_by` with the current Onshape user id.
- Bulk release dialog (`app/components/mfg/BulkReleaseDialog.tsx`) for releasing multiple eligible parts at once.
- Part search/sort/data hooks: `usePartsData`, `usePartsSearch`, `usePartsSort` (`app/onshape_connector/hooks/`) — client-side fuzzy search (via `fuse.js` dependency) and sorting over the fetched part list.
- Part-number input with validation (`app/components/mfg/PartNumberInput.tsx`), manufacturing-state badge/enum (`ManufacturingStateBadge.tsx`, `PartMfgState.tsx`), color-coded part chips (`PartColorChip.tsx`).
- Kanban board (`app/(main)/kanban/`, `app/components/mfg/kanban/board/KanbanBoard.tsx`) built on `@dnd-kit` for drag-and-drop card movement between columns; `KanbanColumn.tsx` / `KanbanColumnCardContainer.tsx` render per-column card lists; `KanbanBulkEditBar.tsx` for multi-select bulk edits; a separate "done" board view (`app/(main)/kanban/done/`).
- Card detail sheet (`KanbanCardDetails.tsx`), assign-to-user dialog (`AssignCardDialog.tsx`), assign machine dialog (`MachineSelectDialog.tsx`), due-date picker (`PartDueDate.tsx`), card header/skeleton components.
- Realtime board sync via Supabase Realtime: `app/components/kanban/KanbanRealtimeSubscriber.tsx` + `app/lib/kanbanApi/useKanbanRealtime.ts` push live card/column updates to all connected clients (no manual refresh needed when a teammate moves a card).
- Kanban REST API: `app/api/kanban/cards` (list/create), `app/api/kanban/cards/[id]` (get/update/delete), `app/api/kanban/config` and `.../config/columns` (board/column configuration), `app/api/mfg/parts/actions` (server actions endpoint for the connector page).
- Process catalog management: add/edit/delete process dialogs and cards (`app/components/mfg/processes/*`), backed by `app/api/processes` + `[id]` and `app/lib/processesApi/processes.ts`.
- Equipment/shop-asset tracking module: grid + card views, filters, category chips, status badges, image gallery/lightbox with upload zone (drag-drop image upload), add/edit/delete dialogs (`app/components/mfg/equipment/*`), backed by `app/api/equipment`, `app/api/equipment/[id]`, and `app/api/equipment/[id]/image` (image upload endpoint) plus `app/lib/equipmentApi/equipment.ts` and `images.ts`.
- Users list view (`app/components/users/UsersList.tsx`, `app/api/users`) showing all Onshape users who have authenticated into the app.

**Third-party integrations**
- Full Onshape OAuth2 + REST API integration: generated typed client under `app/lib/onshapeApi/generated/` (produced via `@hey-api/openapi-ts`, `npm run generate:onshape-client`), covering parts, thumbnails, document versions/workspaces.
- Onshape thumbnail proxy (`app/api/onshape/thumbnail/route.ts`) — fetches part thumbnails server-side with the user's token so the browser never needs an Onshape bearer token.
- Onshape version/token status endpoints (`app/api/onshape/version`, `app/api/onshape/token`).

## Integrations
Onshape (OAuth2 + REST API for parts/thumbnails/documents) is the only third-party integration. No Slack/Discord/email/SMS/TBA/Google integration found.

## Notable Implementation Details
- Card identity across Onshape's workspace/version/microversion (w/v/m) model is handled via a composite key of `partNumber` + `onshapeVersionId` rather than trusting Onshape's raw element/part IDs alone — worth studying `versionUtils.ts::extractVersionId` if re-implementing a CAD-linked BOM/kanban.
- Thumbnails are always proxied server-side (`/api/onshape/thumbnail`) rather than the client hitting Onshape directly, to keep the OAuth bearer token off the client — a clean pattern for any "external CAD image" integration.
- Verbose `console.log`-based tracing (not a structured logger) throughout the OAuth flow files (`route.ts`, `callback/route.ts`) — noisy but genuinely useful for anyone debugging Onshape's iframe/redirect-loop OAuth quirks (explicit "prevent redirect loop" guards for `/auth/*` and `/signin` destinations, and an `auth=success` query param bypass for iframe contexts).
- `openapi-ts-error-1762611211215.log` committed at repo root — stray build artifact left in the tree, a smell to avoid copying.
- No authorization/role model at all: the entire app trusts "logged into the team's Onshape account" as sufficient access control, appropriate only for a single-team internal tool, not a multi-tenant product.
- Migrations are hand-written sequential `.sql` files applied outside of any visible Supabase-CLI migration harness (no `supabase/` config directory in the tree) — a lighter-weight but riskier migration-as-code pattern than a supabase-cli-managed project.

## Verdict
Substantive and directly relevant: the clearest example among surveyed repos of a real Onshape-CAD-to-manufacturing-kanban pipeline, with a concrete data model for linking kanban cards to specific CAD document versions and a working eligibility/release/realtime-board flow — worth stealing the composite (part-number + version-id) card-identity pattern and the server-side thumbnail-proxy pattern; the OAuth flow code is otherwise unremarkable boilerplate. No license file, so treat as ideas-only.
