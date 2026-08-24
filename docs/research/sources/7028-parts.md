# 7028-parts — Source Survey

**Repo:** owenrossing/7028-parts — https://github.com/OwenRossing/7028-parts
**Surveyed-at:** 033964970f4b6b450e868174856e5021b0279615
**Permalink form:** https://github.com/OwenRossing/7028-parts/blob/033964970f4b6b450e868174856e5021b0279615/<path>
**Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma + PostgreSQL, Tailwind CSS, TanStack React Query v5, Zod, S3/local file storage, Server-Sent Events
**License:** none (all rights reserved) — no LICENSE file in the repo tree; ideas only, no code reuse.
**Last activity:** 2026-03-28 (pushed_at 2026-03-28T14:12:41Z; latest commit same date)
**FRC team:** 7028 (team number is hardcoded as the default in `lib/part-number.ts` and referenced throughout `CLAUDE.md`)
**Areas:** (6) part design/manufacturing tracking (primary); (2) people/rosters (owner/user model); (3) third-party integrations (Onshape CAD API stub, Google OAuth)

## Purpose
A full-stack manufacturing parts tracker for FRC teams: tracks each robot part's design-to-completion status (Designed → Cut → Machined → Assembled → Verified → Done), who owns/is machining it, photos of progress, and BOM import from CSV or Onshape. Built explicitly as a "v2 rewrite" of an earlier tracker for team 7028.

## Auth & Roles
- Cookie-based sessions (httpOnly, `sameSite=lax`, configurable secure flag) stored in a `Session` Prisma model with TTL and `lastSeenAt` tracking — `lib/auth.ts`.
- Two auth modes selected by `APP_MODE` env var (`lib/app-mode.ts`): **production** = Google OAuth only (ID token verified against Google's `tokeninfo` endpoint, optional `@domain` allowlist via `GOOGLE_AUTH_DOMAIN`) — `app/api/auth/google/route.ts`; **local/demo** = shared-DB user picker gated by a `LOCAL_MASTER_KEY` — `app/api/auth/local-login/route.ts`.
- Users are keyed by email so a Google login and a local login with the same email merge into one `User` row.
- Admin role is **env-only**: `ADMIN_EMAILS` comma-separated allowlist checked at request time, no DB admin flag/table — `lib/admin.ts`.
- Part-level permissions: `lib/permissions.ts` — `isAdminUser()`, `canManagePart()` (admin OR a `PartOwner` row with role PRIMARY/COLLABORATOR), `editorContext()` for UI edit-affordance decisions. Any authenticated user can create parts/import BOMs; admin is only required for destructive ops (per `CLAUDE.md`).

## Data Model
Prisma schema (`prisma/schema.prisma`):
- `User` (id, email unique, displayName, avatarUrl) → `Session[]`, `PartEvent[]` (as actor), `PartPhoto[]` (as uploader), `ImportBatch[]` (as starter), `PartOwner[]` (owned parts)
- `Session` — id, userId, expiresAt, lastSeenAt, userAgent
- `Project` — id, name, season → `Part[]`, `ImportBatch[]`
- `WorkspaceTeam` / `WorkspaceRobot` / `WorkspaceSubsystem` — team → robot → subsystem hierarchy config (composite PKs), replacing raw SQL config tables
- `Part` — partNumber (unique per project), name, description, material, `PartStatus` enum, quantityRequired/quantityComplete, priority, plus four Onshape linkage fields (documentId/workspaceId/elementId/partId) with a composite index for CAD lookups → `PartOwner[]`, `PartPhoto[]`, `PartThumbnail?`, `PartEvent[]`, `ImportRow[]`
- `PartOwner` — join table, `PartOwnerRole` enum (PRIMARY/COLLABORATOR), unique on (partId, userId)
- `PartPhoto` / `PartThumbnail` — uploaded progress photos with storage key, dimensions, dedicated thumbnail record
- `PartEvent` — append-only audit log (CREATED/UPDATED/STATUS_CHANGED/PHOTO_ADDED/PHOTO_DELETED/OWNER_ADDED/OWNER_REMOVED/IMPORTED) with fromStatus/toStatus and a JSON payload
- `ImportBatch` / `ImportRow` — BOM import pipeline: batch has PREVIEW/COMMITTED/FAILED status; each row carries a computed `ImportRowAction` (CREATE/UPDATE/NO_CHANGE/ERROR) and resolves to a `Part` on commit

## Features

**Part design/manufacturing tracking**
- Six-stage part status workflow (`DESIGNED→CUT→MACHINED→ASSEMBLED→VERIFIED→DONE`) with an explicit legal-transition graph and a collapsed 4-stage "workflow stage" view (Unassigned/Assigned/Machined/Completed) for dashboard grouping — `lib/status.ts`
- Structured part-number scheme `TEAM-SEASON-ROBOT-SUBSYSTEM-SEQUENCE` (e.g. `7028-26-1-3-042`) with regex validation, sanitizers, and a builder helper — `lib/part-number.ts`
- Part CRUD, status transitions with permission checks, and audit-event emission on every mutation — `app/api/projects/[id]/parts/[partId]/route.ts`, `.../status/route.ts`
- Part ownership assignment (primary/collaborator) — `app/api/projects/[id]/parts/[partId]/owners/route.ts`
- Progress photos per part with a dedicated thumbnail record — `app/api/projects/[id]/parts/[partId]/photos/route.ts`
- Onshape CAD linkage fields on `Part` (documentId/workspaceId/elementId/partId) indexed for lookup, referenced as a wired-but-stubbed import source
- BOM import pipeline: upload CSV → parsed and diffed against existing parts by part number to classify each row CREATE/UPDATE/NO_CHANGE/ERROR in a PREVIEW batch, then a separate commit step applies rows transactionally and emits `IMPORTED` part-events — `app/api/projects/[id]/import/route.ts`, `.../import/[batchId]/commit/route.ts`
- Real-time updates via a project-scoped in-memory SSE registry (`Map<projectId, Set<controller>>`) that mutation handlers `broadcast()` into; client hook auto-reconnects with backoff — `lib/sse-registry.ts`, `app/api/projects/[id]/events/route.ts`, `hooks/use-sse.ts`
- Workspace hierarchy config (team → robot → subsystem) driving part-number defaults, exposed via `/api/workspace`, `/api/workspace/robots`, `/api/workspace/teams`, `/api/workspace/subsystems`
- Parts explorer UI: grouping by status/priority/student-owner, a "TODO" view splitting active (your turn) vs waiting (blocked upstream) — `components/parts-explorer/*`

**People/rosters**
- User directory and admin user management endpoint — `app/api/users/route.ts`, `app/api/admin/users/route.ts`
- Part ownership as the roster linkage (who's assigned to make what) rather than a standalone roster feature

**Third-party integrations**
- Google OAuth (ID-token verification flow, no full OAuth redirect dance) — `app/api/auth/google/route.ts`
- Onshape CAD linkage fields and an `onshape_api` import source type wired into the BOM importer contract, though the actual Onshape provider is stubbed ("would be populated via `lib/bom/onshape-provider.ts`") at the surveyed commit

## Integrations
Google OAuth (production login), Onshape CAD (part linkage fields + import-source contract, provider stubbed), pluggable file storage (local disk or S3 via `@aws-sdk/client-s3`) — `lib/storage.ts`.

## Notable Implementation Details
- **Env-only admin, no DB role table** — simplest possible RBAC for a small team; re-implementers wanting more than one admin tier would need to add a real roles table.
- **Local/demo auth mode as a first-class alternative to OAuth** — a shared master key plus a user picker lets a team run the tool on a LAN without Google config; worth stealing for teams that don't want to set up OAuth for an internal tool.
- **SSE registry is in-memory and single-process** — fine for a single small-team deployment but won't survive multi-instance/serverless scaling (a real limit to flag if recreating on Vercel-style infra); Node.js runtime is required (not edge) for the SSE route.
- **Part-number scheme bakes team/season/robot/subsystem into the ID string itself**, with regex validation and normalization helpers, rather than storing those as separate FK columns on `Part` — makes the ID human-legible but couples parsing logic to a fixed format.
- **BOM import is a two-phase PREVIEW/COMMIT pattern** with per-row diffing against existing parts before any writes — a good pattern to copy for any bulk-import feature to avoid partial/garbage imports.
- **CSV parsing is naive** (`line.split(",")`, no quoted-field/escaping support) — a real gap if teams export CSVs with commas in names/descriptions.
- Repo contains a large amount of AI-agent scaffolding cruft (`.claude/worktrees/`, `DEBATE_*.md`, `FACT_CHECK_*.md`, multiple `*_DESIGN_BRIEF.md`, `TRANSFER.md`) — a byproduct of AI-assisted development, not app functionality; skip when reading.
- Storage path traversal is guarded explicitly in `LocalStorageProvider` (`finalPath.startsWith(UPLOAD_ROOT)` check) before write/delete — a good defensive pattern for any local-upload feature.

## Verdict
Substantive and directly relevant — a compact, well-documented single-team parts tracker with a genuinely useful status-workflow model, two-phase BOM import pattern, and an env-only-admin/local-auth-mode approach worth stealing for small-team internal tools; the Onshape integration itself is only a stub at this commit.
