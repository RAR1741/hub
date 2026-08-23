# kanshape — Source Survey

**Repo:** https://github.com/wave-2826/kanshape (FRC Team 2826, Wave Robotics)
**Surveyed at commit:** `47349323eac8259c38f05da7bf89abf44f29b300`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/wave-2826/kanshape/blob/47349323eac8259c38f05da7bf89abf44f29b300/<path>`

## Purpose

Kanshape is a Kanban board application for tracking subteams' work and part-manufacturing
timelines, with tight Onshape integration: a document-side panel lets designers link parts to
tasks directly from CAD, and every linked Onshape document gets its own Kanban tab showing active
tasks. Work is organized as Projects → (optional) Subprojects → Boards → Sections (columns) →
Cards, where a card can carry manufacturing metadata (assigned Onshape part, revision tracking,
CAD-format exports) or be a plain software/generic task. The README explicitly states it is "a
heavy work-in-progress" and stresses it is "intentionally *not* vibe-coded." Primarily a
design-manufacturing kanban tool, but its scope reaches further than hawk-shop's: it also covers
lightweight people/roster features (user groups, an admin console) and a productivity leaderboard,
though it has no attendance tracking or purchasing/order tracking.

## Stack

- **Frontend:** SvelteKit (Svelte 5, runes) under `sk/`, built as a static site
  (`@sveltejs/adapter-static`) and served by the backend's `publicDir`. Sass/SCSS for styling,
  `@lucide/svelte` icons, `three.js` (+ a custom trackball-controls fork) for in-app 3D preview of
  Onshape part geometry, `openapi-fetch` for typed calls against a generated Onshape OpenAPI
  client. `sk/package.json`, `sk/src/lib/components/parts/PartPreviewRenderer.svelte`.
- **Backend:** PocketBase (Go), used as both the auth/database server and the application-logic
  layer via its JS pb_hooks runtime (`pb/pb_hooks/*.js`) — there is no separate Node/API server.
  PocketBase's own SQLite-backed collections define the schema; `pb/pb_migrations/` holds ~140
  incremental migration files (collections created/evolved over the project's life), and
  `sk/src/lib/pocketbase/generated-types.ts` is generated from the live schema via
  `pocketbase-typegen`.
- **Client SDK:** the official `pocketbase` JS SDK (`sk/src/lib/pocketbase/index.ts`), giving
  realtime subscriptions, auth, and file storage for free from PocketBase.
- **License:** MIT. Root `LICENSE.md` reads "Copyright (c) 2022 - present, Jitesh Doshi" — this
  name does not match the project's own authorship (Wave 2826) and is very likely inherited
  unedited from a SvelteKit starter template the project was scaffolded from; worth a note but
  the license terms themselves are permissive MIT regardless. The vendored PocketBase binary
  carries its own (also MIT) license at `pb/LICENSE.md`, correctly attributed to PocketBase's
  author, Gani Georgiev.
- **Deployment:** Docker Compose with two services — `sk` builds the SvelteKit static site once
  (via `pnpm install && npm run build`) and exits, then `pb` runs the PocketBase binary serving
  both the API and the built static frontend as its `publicDir`. `docker-compose.yml`, `Dockerfile`,
  `pb/entrypoint.sh`.
- **Last activity / status:** most recent migration timestamp corresponds to early August 2026 and
  `git log -1` on the surveyed pin is dated 2026-08-06 — actively developed, pre-1.0 ("heavy
  work-in-progress" per the README), not abandoned.

## Auth & Roles

- **Identity:** PocketBase's built-in `users` auth collection, extended with app fields
  (`sk/src/lib/pocketbase/generated-types.ts`, `UsersRecord`): `name`, `avatar`, `metadata` (JSON),
  `groups` (relation, multi), `is_admin` (bool), `onshape_oauth` (JSON — a user's personal Onshape
  OAuth tokens, described below).
- **Login methods:** password auth is present in the schema but **disabled by default**
  (`passwordAuth.enabled: false` on the `users` collection in the initial migration snapshot,
  `pb/pb_migrations/1778457777_collections_snapshot.js`); the intended path is a configurable
  generic OAuth2 provider ("configurable SSO" per the README), requesting `openid email profile
  groups` scopes. `sk/src/lib/pocketbase/auth.ts` (`providerLogin`), `sk/src/routes/login/+page.svelte`.
- **OAuth-to-admin group mapping.** A PocketBase hook maps identity-provider group claims to the
  app's own `is_admin` flag: on every OAuth2 login, if any of the user's IdP `groups` (from the
  provider's raw user info) match a configured comma-separated admin-groups list
  (`auth/oAuthAdminGroups` in `config`), the user's `is_admin` is set true.
  `pb/pb_hooks/oauth_admin_groups.pb.js`.
- **Team groups.** Independent of the admin flag, users belong to arbitrary named `groups`
  (e.g. subteams) with member/card-count rollups (`group_overview` view), used for group-based card
  assignment (see Features). `pb/pb_hooks/main.pb.js`? — schema:
  `sk/src/lib/pocketbase/generated-types.ts` (`GroupsRecord`, `GroupOverviewRecord`),
  `sk/src/routes/(authed)/users/GroupEditView.svelte`, `GroupsTable.svelte`.
- **Onshape identity is separate from app identity.** Each user separately authorizes Onshape
  access via its own OAuth2 code-exchange flow (not PocketBase's built-in OAuth2), storing
  per-user access/refresh tokens in `users.onshape_oauth`; tokens are refreshed transparently
  (60-second-early refresh window) whenever a valid token is needed.
  `pb/pb_hooks/onshape/onshape_auth.js` (`getValidOnshapeToken`, `refreshOnshapeToken`), backed by
  a short-lived `oauth_transactions` collection (XSRF state, redirect URI, return path) that is
  periodically swept of expired rows.
- **Authorization model beyond admin/non-admin:** the PocketBase collection rules seen
  (`listRule`/`viewRule`/etc.) are largely `null` (server-hook/API-controlled) rather than
  declarative per-record rules, so access control for most collections lives in the pb_hooks layer
  rather than PocketBase's declarative rule engine.

## Data Model

(PocketBase collections; current shape reconstructed from
`sk/src/lib/pocketbase/generated-types.ts`, which mirrors `pb/pb_migrations/`)

- **projects** — `title`, `description`, `color`, `boards` (relation, multi), `subprojects`
  (relation, multi), `linked_sites` (JSON — external documentation links). A **project_overview**
  view rolls up card/finished-card/overdue counts and next-due date per project.
- **subprojects** — `name`, `description`, `part_id_offset` (for per-subproject part numbering),
  `linked_sites`. **subproject_overview** view mirrors the project rollups per subproject.
- **boards** — `title`, `description`, `type` (`blank` | `parts` | `software` — determines which
  card fields/behavior apply), `part_id_prefix` + `current_part_id` (auto part numbering, boards
  of type `parts`), `custom_card_fields` (JSON — user-defined extra fields per board),
  `linked_sites`, `sections` (relation, multi, ordered). **board_overview** view: card/finished/
  overdue counts, next due date.
- **sections** — a board's kanban columns: `title`, `color`, `position`, `is_completed` (marks a
  column as the "done" state for leaderboard/rollup purposes).
- **cards** — the core task/part record: `title`, `description`, `board`, `section`,
  `subprojects` (multi), `position`, `priority` (`low`/`medium`/`high`/`critical`), `due_by`,
  `duration_days`, `dependencies` (relation, multi, self-referential — for the Gantt view),
  `assignment_data` (JSON — see below), `metadata` (JSON — arbitrary custom-field values keyed to
  `custom_card_fields`), `files` (multi-file attachments), `created_by`, `moved_at`.
  A denormalized **card_preview** view adds `board_name`, `section_name`/`section_color`,
  `assignment_name_cache`, and resolved `subprojects` for fast list rendering. A further
  **part_cards** view joins in `project`/`project_color`/`project_title` specifically for
  parts-board cards.
- **parts** — an Onshape part tracked by the manufacturing side of a board: `document_id`,
  `wvm`/`wvm_id` (workspace/version/microversion selector), `element_id`, `part_id`,
  `configuration`, `revision` (number), `type` (`part`|`assembly`), `part_data` (JSON — cached
  Onshape metadata), `preview_model` (a cached 3D preview file), `current_card` (relation to the
  active card), `past_revision_cards` (relation, multi — history of cards from earlier revisions
  of the same part).
- **onshape_documents** — a linked Onshape document: `title`, `workspace_id`, `project`/
  `subproject` (which project/subproject it's linked under) — this is what powers the
  document-side Kanban tab.
- **card_assignment_cache** — denormalized `(card, user, group)` rows resolved from a card's
  `assignment_data`, used to answer "what's assigned to me" efficiently without re-parsing JSON
  per card.
- **groups** — `name`, `description`; **group_overview** adds `member_count`/`card_count`.
- **leaderboard** — per-`(user, project)` (and a `project = null` global row) counters:
  `tasks_completed`, `tasks_created`, `tasks_assigned`.
- **activity_log** — an audit trail: `action` (`create`/`update`/`delete`), `entity_type`
  (`project`/`board`/`section`/`card`/`subproject`), `entity_id`, `entity_title`, `actor`,
  `changes` (JSON diff), `project_id`, `date`. **activity_log_preview** denormalizes actor name and
  project title/color for the activity feed UI.
- **config** — a flat `key`/`value` store for app-wide settings (e.g. `auth/oAuthAdminGroups`,
  Onshape client id/secret), read via `pb/pb_hooks/config.js`.
- **oauth_transactions** — short-lived Onshape OAuth flow state (see Auth & Roles).
- **onshape_api_cache** — a generic response cache (`hash`, `body`, `headers`, `statusCode`,
  `timestamp`) for Onshape API calls, to reduce redundant upstream requests.
- **active_webhooks** — tracks Onshape webhook subscriptions this instance has registered
  (`webhook_id`, `url`, `events`, scoped by `document_id`/`company_id`/`client_id`), so the app can
  react to Onshape-side changes (new revisions, translations completing, etc.) instead of polling.
- **export_queue** — tracks in-flight/completed Onshape file-translation exports for a part
  (`type`, `status`, `translation_id`, `file_id`, `error_message`, linked `card`/`part_record`).
- **files** — a generic small file-registry collection (`file`, `path`).

## Features

- **Projects and subprojects** — Create/rename/describe/color-tag a project; optionally split it
  into subprojects (e.g. subsystems) for categorization and per-subproject part-number offsets.
  `sk/src/routes/(authed)/projects/new/+page.svelte`, `.../[id]/SettingsPage.svelte`,
  `.../[id]/subprojects/[subprojectId]/+page.svelte`.
- **Boards with three types** — Blank (generic task board), Parts (manufacturing-oriented, with
  auto part numbering), and Software boards, each surfacing different card fields.
  `sk/src/lib/components/projects/BoardSettings.svelte`,
  `sk/src/routes/(authed)/projects/[id]/boards/[boardId]/settings/+page.svelte`.
- **Configurable sections (columns)** — Add, reorder, color, and mark a section as the
  "completed" state (drives leaderboard/rollup counting).
  `sk/src/lib/components/kanban/KanbanBoard.svelte`.
- **Kanban board view** — Drag cards between sections; per-board menu with filtering.
  `sk/src/lib/components/kanban/KanbanBoard.svelte`, `KanbanCard.svelte`,
  `sk/src/lib/components/kanban/menu/FilterMenu.svelte`, `filter.ts`.
- **List view** — Flat, filterable list alternative to the board layout.
  `sk/src/routes/(authed)/projects/[id]/boards/[boardId]/(kanban)/list/+page.svelte`,
  `sk/src/lib/components/kanban/KanbanList.svelte`, `KanbanListEntry.svelte`.
- **Gantt/timeline view** — Renders cards against `due_by`/`duration_days`/`dependencies` as a
  dependency-aware Gantt chart, with its own layout algorithm and unit tests.
  `sk/src/routes/(authed)/projects/[id]/boards/[boardId]/(kanban)/gantt/+page.svelte`,
  `sk/src/lib/components/gantt/Gantt.svelte`, `GanttChart.svelte`, `layout.ts`, `layout.test.ts`.
- **Card detail panel** — Full card editor: title, description, priority, due date, duration,
  dependencies, custom fields (schema-driven per board), file attachments, assignment.
  `sk/src/lib/components/kanban/cardView/CardView.svelte`, `CardViewPanel.svelte`,
  `fieldEditor/CardFieldEditor.svelte`, `fieldEditor/CardFieldEditorFull.svelte`,
  `fieldEditor/CardFieldFilesEditor.svelte`.
- **Custom per-board card fields** — Board owners define extra typed fields (schema editor) that
  every card on that board can carry, stored in each card's `metadata` JSON.
  `sk/src/lib/components/kanban/cardView/schemaEditor/CardFieldSchemaEditor.svelte`,
  `sk/src/lib/components/projects/CustomCardFieldDetails.svelte`.
- **Card assignment (user, group, "anyone", or "looking for assignment")** — A card's
  `assignment_data` can target specific users, an entire group (resolved to its member list at
  read time), be open to anyone, or explicitly flagged as unassigned/needing a volunteer.
  `sk/src/lib/components/kanban/cardView/CardAssignmentValue.svelte`,
  `pb/pb_hooks/leaderboard.js` (`resolveAssignedUserIds`).
- **Card dependencies** — Cards can depend on other cards (used by the Gantt view for sequencing).
  `sk/src/lib/components/kanban/cardView/CardDependencySelector.svelte`.
- **Onshape part linking on a card** — Attach a specific Onshape part (by document/workspace-or-
  version/element/part id + configuration) to a manufacturing card, with an interactive 3D preview
  rendered client-side via three.js. `sk/src/lib/components/parts/CardPart.svelte`,
  `CardPartEditor.svelte`, `CardPartModal.svelte`, `PartPreviewRenderer.svelte`, `renderer.ts`.
- **Automatic part numbering** — Parts boards assign sequential part numbers with a configurable
  prefix and (optionally) a per-subproject numeric offset. `boards.part_id_prefix`/
  `current_part_id`, `subprojects.part_id_offset`.
- **Part revision tracking** — When a linked Onshape part is revised, the card's history of past
  revisions is preserved (`parts.past_revision_cards`) rather than silently overwritten.
- **CAD file export from a card** — Kick off an Onshape translation job (DXF, STEP, GLTF, or OBJ)
  for a card's linked part directly from the app, tracked through to completion via the
  `export_queue`. `pb/pb_hooks/onshape/exports.js`, `sk/src/lib/data/parts.ts` (`PartExportType`).
- **Onshape document-side Kanban tab** — A linked Onshape document gains its own tab/panel (an
  Onshape app extension, "onshape_bridge") showing that document's active tasks in place, so
  designers can see and update manufacturing status without leaving CAD.
  `sk/src/lib/onshape/onshape_bridge/`, `pb/pb_hooks/onshape/onshape_frame.pb.js`,
  `sk/src/routes/(authed)/onshape/document/+page.svelte`.
- **Link/select an Onshape document to a project** — Browse and attach Onshape documents to a
  project/subproject from within the app. `sk/src/routes/(authed)/onshape/+page.svelte`,
  `LinkOnshapeDocument.svelte`, `new/+page.svelte`, `new/PartSelectButton.svelte`.
- **Live Onshape webhooks** — The app registers persistent Onshape webhooks (scoped to a document/
  company/client) so revision creation, translation completion, and related events push updates
  instead of the app polling Onshape. `pb/pb_hooks/onshape/webhooks.js`.
- **Onshape API response caching** — Reduces redundant Onshape calls via a hashed response cache
  with headers/status/timestamp. `onshape_api_cache` collection, `pb/pb_hooks/onshape/onshape.pb.js`.
- **Users and groups admin console** — List/edit users, assign group membership, create/edit/
  delete groups, with member and card-count rollups per group.
  `sk/src/routes/(authed)/users/+page.svelte`, `UsersTable.svelte`, `UsersEditView.svelte`,
  `GroupsTable.svelte`, `GroupEditView.svelte`.
- **Leaderboard** — Per-user, per-project and global counters for tasks completed/created/
  assigned, aggregated by a PocketBase hook whenever cards move into a "completed" section or are
  created/assigned. `sk/src/routes/(authed)/leaderboard/+page.svelte`,
  `pb/pb_hooks/leaderboard.js`.
- **Activity log** — A chronological, filterable audit feed of create/update/delete actions across
  projects, boards, sections, subprojects, and cards, with diffed `changes`.
  `sk/src/routes/(authed)/log/+page.svelte`, `ActivityEntry.svelte`, `pb/pb_hooks/activity_log.js`.
- **Site/documentation linking** — Attach arbitrary external documentation links to a project,
  subproject, or board. `sk/src/lib/components/projects/LinkedSiteDetails.svelte`, `SiteLinks.svelte`.
- **File manager / avatar and asset uploads** — General file upload UI reused for card attachments
  and user avatars. `sk/src/routes/(authed)/settings/FileManager.svelte`, `FileInput.svelte`,
  `FileDisplay.svelte`.
- **Theme selector** — Light/dark (or system) theme toggle in the nav. `sk/src/lib/components/nav/ThemeSelector.svelte`.
- **Mobile-responsive layout** — Explicit responsive breakpoints/list view for narrow screens per
  the README and `images/mobile.png`.

Not yet implemented per the README's own checklist: embedded previews for linked documentation
sites, email/Slack notifications for task updates, and inventory/material stock tracking (listed
as scope but unchecked).

## Integrations

- **Onshape (OAuth2, REST API, webhooks, document-side app extension)** — the central integration:
  per-user OAuth tokens (`pb/pb_hooks/onshape/onshape_auth.js`), a generated OpenAPI client
  (`sk/src/lib/onshape/client.ts`, `schema.d.ts`, `generate-schema.sh`), persistent webhooks for
  push updates (`pb/pb_hooks/onshape/webhooks.js`), CAD translation/export jobs
  (`pb/pb_hooks/onshape/exports.js`), and an embeddable panel/tab that runs inside Onshape itself
  (`sk/src/lib/onshape/onshape_bridge/`, `pb/pb_hooks/onshape/onshape_frame.pb.js`). Also uses
  Onshape FeatureScript for part-metadata heuristics (`sk/src/lib/onshape/partHeuristics.fs`,
  `pb/pb_hooks/onshape/metadata_parts.js`).
- **Generic OAuth2 / OIDC identity provider** — configurable SSO for app login itself (separate
  from the Onshape OAuth above), reading `openid email profile groups` scopes and mapping IdP
  group membership to the `is_admin` flag. `sk/src/lib/pocketbase/auth.ts`,
  `pb/pb_hooks/oauth_admin_groups.pb.js`.
- No email or chat-notification integration is implemented yet (explicitly unchecked in the
  README's feature list).

## Notable Implementation Details

- **PocketBase as the entire backend.** There is no custom Node/Express/etc. API layer — business
  logic (leaderboard updates, activity logging, Onshape OAuth, webhook management, part export)
  lives entirely in PocketBase's JS hook runtime (`pb/pb_hooks/*.js`), and the frontend talks
  directly to PocketBase's REST/realtime API via the official JS SDK. This is a much heavier
  reliance on a single BaaS than hawk-shop's approach (below).
  `pb/pb_hooks/main.pb.js`, `sk/src/lib/pocketbase/index.ts`.
- **~140 incremental PocketBase migrations, one per schema edit.** Because PocketBase's admin UI
  generates a migration file per collection change, the history is extremely fine-grained (e.g.
  `1778892647_updated_cards.js`, `1778892680_updated_cards.js` seconds apart) rather than
  hand-batched — a side effect of PocketBase-driven schema evolution worth knowing before mining
  the migration history for "what changed and why."
- **Denormalized "preview"/"overview" collections everywhere.** Nearly every core collection has a
  paired read-optimized view (`card_preview`, `project_overview`, `board_overview`,
  `subproject_overview`, `group_overview`, `activity_log_preview`) that pre-joins names/colors/
  counts so list UIs avoid N+1 relation expansion — a pattern worth copying if a reimplementation
  also wants fast list views without hand-rolled joins on every request.
- **Group-based assignment resolves lazily and admits it's O(n) per group.** `resolveAssignedUserIds`
  in `pb/pb_hooks/leaderboard.js` queries group membership per group id in a loop with the comment
  "i <3 N+1" — a deliberately-acknowledged inefficiency for what is presumably a small team roster.
- **Onshape OAuth is hand-rolled, not PocketBase's OAuth2, because it's a second, independent
  identity.** The code comments in `pb_hooks/onshape/onshape_auth.js` walk through why: the app
  needs a personal Onshape token per user *in addition to* however they authenticated into the app
  itself (which might be a different, app-level SSO), and Onshape's docs don't fully cover their
  OAuth flow's edge cases, so it was implemented directly against RFC 6749 with defensive comments
  about uncertainty (e.g. "I'm not 100% certain on this... but Onshape's OAuth endpoints seem to
  faithfully follow RFC 6749").
- **Root LICENSE.md has the wrong name.** `LICENSE.md` at the repo root is MIT but is attributed to
  "Jitesh Doshi, 2022–present" — not a project author found elsewhere in the repo — strongly
  suggesting it was copied from a SvelteKit starter template's license file and never edited. The
  terms (MIT) are still valid and permissive; only the copyright attribution looks stale. The
  vendored PocketBase binary's own `pb/LICENSE.md` is correctly attributed to PocketBase's actual
  author.
- **Cross-reference to hawk-shop.** Both kanshape and `FRC2713/hawk-shop` (surveyed separately,
  `docs/research/sources/hawk-shop.md`) tackle the same core problem — releasing/tracking Onshape
  CAD parts through a manufacturing kanban board — but differ in almost every architectural
  choice: kanshape is Svelte 5 + PocketBase (a single BaaS holding ~20 collections, business logic
  in server-side JS hooks, real per-user Onshape OAuth tokens, webhooks for push updates, group-
  based RBAC via IdP claims) versus hawk-shop's React/TanStack Start + Drizzle/SQLite (a small,
  purpose-built relational schema, no role system at all — any authenticated user has full access
  — and SSE instead of webhooks). kanshape is unambiguously the more feature-complete of the two
  (subprojects, Gantt view, part revision history, CAD export, activity log, leaderboard, groups)
  at the cost of far more moving parts and a heavier admin surface; hawk-shop is smaller and
  easier to audit/reason about, and its part-eligibility gating logic is a reasonable pattern to
  borrow regardless of which base a reimplementation follows. kanshape's clean MIT license (module
  license-attribution mixup aside) makes it the lower-risk of the two to draw concrete
  implementation patterns from, versus hawk-shop's unclear all-rights-reserved default.
