# frc-part-tracker — Source Survey

**Repo:** https://github.com/rogowskicr/frc-part-tracker
**Surveyed at commit:** `e1f9121a6fe96c0de1431bae106f7a777f3180be`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/rogowskicr/frc-part-tracker/blob/e1f9121a6fe96c0de1431bae106f7a777f3180be/<path>`

## Purpose

FRC Part Tracker is a web app for tracking parts and subassemblies through the design →
manufacturing → assembly pipeline of a robot build season, with a deep OnShape CAD integration
(BOM import, part-number sync, thumbnail/STEP/STL export) and per-vendor purchasing/order tracking
for off-the-shelf (COTS) parts. Its README frames it as "Phase 1"-labeled but the codebase and
migration history (through a `phase5`-tagged migration and beyond) show substantially more built:
multi-team membership, multi-project-per-season namespacing, manufacturing-process assignment, and
a COTS order board. Commit dates run **2026-05-06 through 2026-05-25** (19 days), all authored in
one continuous burst — it reads as a single build sprint rather than an established, multi-season
tool; no evidence of production use across a season.

## Stack

- **Language/Framework:** TypeScript, Next.js 16 (App Router), React 19. `package.json`.
- **Database:** PostgreSQL via Supabase (`@supabase/supabase-js`, `@supabase/ssr`). Schema managed
  as committed SQL migrations under `supabase/migrations/` (27 files, `20260506000000` through
  `20260525000001`), applied via the Supabase CLI/SQL editor — no ORM.
- **Auth:** Supabase Auth, but usernames rather than email addresses — `signup`/`login`
  (`src/app/actions/auth.ts`) synthesize a fake address `${username}@frc-part-tracker.local` and
  pass it to `supabase.auth.signUp`/`signInWithPassword`, so Supabase's real email/password auth
  backs what the UI presents as username/password.
- **Frontend:** Server Components + Server Actions (`'use server'` files under `src/app/actions/`)
  for all mutations; a handful of client components (`OrdersClient.tsx`, `ManufacturingQueue.tsx`,
  `TeamsPanel.tsx`, inline-edit buttons) for interactivity. Tailwind CSS v4, dark theme only
  (`src/app/globals.css`).
- **Validation:** Zod is a dependency (`package.json`) but part/assembly-number format validation
  is hand-rolled regex in `src/lib/validation.ts`, not Zod schemas.
- **License:** none found — no `LICENSE`/`COPYING` file and no `license` field in `package.json`.
  Treat as all-rights-reserved.
- **Hosting:** Vercel (per `IMPLEMENTATION_PLAN.md`); no Dockerfile, no CI workflow in the repo.

## Auth & Roles

- **Roles:** `admin | engineer | viewer`, stored per-membership in `team_memberships.role` and
  mirrored onto `user_profiles.role` for the user's *currently active* team
  (`supabase/migrations/20260507000001_team_memberships.sql`,
  `20260507000012_phase2_viewer_role.sql`). `viewer` is read-only everywhere — every Server Action
  in `src/app/actions/*.ts` opens with a `profile.role === 'viewer'` check before mutating,
  duplicated per-action rather than centralized in one guard.
- **Signup/login flow:** username + password only, no email verification, no OAuth. Passwords are
  Supabase Auth's own (bcrypt-backed) — the app never touches raw password hashing.
  `src/app/actions/auth.ts`.
- **Team creation vs. joining:** `signup` calls one of two Postgres RPCs depending on a `mode` form
  field — `complete_signup` (creates a team, caller becomes `admin`) or `join_team` (looks up a
  team by its 6-character join code, caller becomes `engineer`). Both RPCs are `security definer`
  so they can read/write across RLS. `supabase/migrations/20260507000000_team_join_code.sql`,
  `20260525000000_unique_team_names.sql`.
- **Multi-team membership:** a user can belong to several teams via `team_memberships
  (user_id, team_id, role)`; `user_profiles.team_id`/`.role` cache the *active* one. Switching
  teams (`switch_active_team` RPC) or leaving (`leave_team`) resets the active project code.
  `src/app/actions/teams.ts`, `supabase/migrations/20260507000001_team_memberships.sql`.
- **Auto-cleanup:** an `AFTER DELETE` trigger on `team_memberships` deletes a team once its last
  member leaves (`20260507000005_auto_delete_empty_teams.sql`) — an unusual, RLS-friendly way to
  avoid orphaned teams instead of a scheduled job.
- **Route gating:** `src/lib/supabase/middleware.ts` (wired from `src/proxy.ts`, matched on nearly
  every path) redirects unauthenticated requests to `/login` and authenticated requests away from
  `/login`/`/signup`; `/help` is public. All authorization beyond that is enforced by Postgres RLS
  policies plus the in-action role checks, not centrally in middleware.
- **RLS pattern:** every team-scoped table carries `team_id`; two `security definer` helper
  functions, `my_team_id()` and `my_role()`, are called inside each policy's `USING`/`WITH CHECK`
  clause instead of duplicating the subquery per table
  (`supabase/migrations/20260506000000_initial_schema.sql`). `admin`/`engineer` can insert/update;
  only `admin` can delete; everyone on the team can `select`.

## Data Model

Base schema in `supabase/migrations/20260506000000_initial_schema.sql`, evolved by 26 further
migrations. Key tables (all UUID PKs):

- **`teams`** — `name` (globally unique, case-insensitive as of `20260525000000`), `year`,
  `join_code` (unique, 6-char, unambiguous alphabet excluding O/0/I/1), `settings jsonb`.
- **`user_profiles`** — 1:1 extension of `auth.users`, auto-created by an `on_auth_user_created`
  trigger (`handle_new_user()`); carries the *active* `team_id`/`role`/`active_project_code`.
- **`team_memberships`** — `(user_id, team_id, role)`, the real multi-team join table added in
  Phase 2 (`20260507000001`).
- **`team_projects`** — `(team_id, year, suffix)` PK; a "project" is a build-season namespace, one
  per `(year, optional single letter)` — teams doing an off-season or second robot get project
  `26A`/`26B` alongside the base `26`. Replaces an earlier `team_seasons` table
  (`20260507000009_projects.sql`).
- **`assemblies`** — self-referential via `parent_assembly_id` (real nullable FK, not a sentinel
  value), `assembly_number` (e.g. `26_A_100`), OnShape linkage fields
  (`onshape_doc_id`/`element_id`/`workspace_id`/`last_sync`), unique per `(team_id,
  assembly_number)`.
- **`parts`** — belongs to one *primary* `assembly_id`, `part_number` nullable (null for COTS
  parts that never got one), `type` enum `manufactured|off_shelf`, `status` enum (see below),
  `assigned_to` (→ `user_profiles`), `naming_flagged` (set when a part's name looks like it should
  have been formatted as a part number but wasn't), OnShape identity fields
  (`onshape_part_id`/`element_id`/`workspace_id`/`thumbnail_url`) used to detect "the same OnShape
  part re-imported into two assemblies."
- **`bom_items`** — join table between a part and *every* assembly it appears in (a part can be
  used in more than one assembly — many-to-many via this table, not a single FK), carrying
  `onshape_quantity` (required qty), `cots_quantity_spare`, `quantity_locked` (skip on re-import),
  and, for COTS parts, `cots_vendor`/`cots_supplier_part_number`/`cots_purchase_link`/
  `cots_ordered`/`cots_received` flags (`20260519000003_bom_cots_ordered.sql` added the ordered
  flag to mirror an earlier received flag).
- **`manufacturing_processes`** — per-team catalog (3D Printing, Laser Cut, CNC Mill, CNC Lathe,
  Hand Fabrication, Welding, Sheet Metal), seeded on team creation.
- **`part_manufacturing`** — assigns a part to a process (or marks it `outsourced` with a vendor),
  free-text `export_file_format`, `notes`. The original `status` enum on this table
  (`not_started|in_progress|complete`) is now dead — the real manufacturing status lives on
  `parts.status` (`src/lib/types.ts` marks `ManufacturingStatus` `@deprecated`).
- **`part_status_history`** — append-only audit log, one row per status transition, with
  `changed_by`/`notes`.
- **`team_onshape_credentials`** — one row per team, `access_key`/`secret_key`, isolated in its own
  table (not a column on `teams`) specifically so RLS can restrict it to admins while regular team
  data stays visible to viewers.
- **`onshape_bom_cache`** / **`onshape_sync_diffs`** — cache OnShape BOM responses per
  `(team_id, cache_key)` to avoid re-hitting the API, and stage a pending add/remove/change diff
  for a human to review before applying it against `parts`/`bom_items`.
- **`cots_orders`** — one row per `(team_id, project_code, vendor)` tracking vendor-level order
  status (`pending|ordered|received`); per-line `cots_ordered`/`cots_received` flags on
  `bom_items` cascade from vendor-level status changes (`src/app/actions/orders.ts`).
- **`team_vendors`** — team-scoped custom vendor names (typed `cots|outsourced|both`) so a vendor
  entered once reappears as an autocomplete suggestion.
- **`part_status`** enum — evolved three times across migrations
  (`20260519000000_phase5_status.sql`, `20260523000000_phase_based_statuses.sql`) from a flat
  5-value list to a 13-value, three-phase model: `on_hold`, `design_{in_progress,complete,
  revised}`, `manufacturing_{ready,in_progress,debur,powder_coating,complete}`,
  `assembly_{robot_ready,on_robot,loose_spare,assembled_spare}`. Old values are migrated forward by
  UPDATE statements in the same migration, and Postgres enum values can't be dropped, so the type
  still carries retired labels (`design`, `in_progress`, `ready_for_manufacturing`, etc. — see
  `20260523000000_phase_based_statuses.sql`).

## Features

- **Signup: create or join a team** — one form, `mode=create|join`; create picks a team name and
  becomes admin (auto-seeds 7 manufacturing processes); join takes a team name + 6-char join code
  and becomes an engineer. `src/app/(auth)/signup/page.tsx`, `src/app/actions/auth.ts`.
- **Username/password login and logout** — `src/app/(auth)/login/page.tsx`,
  `src/app/actions/auth.ts`.
- **Dashboard** — per-active-project stat cards (assembly count, part count, in-progress count,
  manufacturing-complete count), a three-phase (Design/Manufacturing/Assembly) status pipeline
  board with per-status counts and an On-Hold callout, a "My Assigned Parts" list, and quick-create
  links; degrades to an all-N/A view with a banner when no project is selected.
  `src/app/(app)/dashboard/page.tsx`.
- **Multi-team switcher / join-another-team / leave-team** — `TeamsPanel` component lets a user
  join an additional team by code, create another team, or switch their active team, all rendered
  on the dashboard. `src/components/TeamsPanel.tsx`, `src/app/actions/teams.ts`.
- **Team page: member roster + role management** — lists members with role badges; admins can
  promote/demote (`admin|engineer|viewer`) or remove a member (self-removal blocked, must "leave"
  instead). `src/app/(app)/team/[id]/page.tsx`, `src/app/(app)/team/[id]/MemberList.tsx`,
  `get_team_members`/`update_member_role`/`remove_team_member` RPCs.
- **Team page: project management** — admins add/remove `(year, suffix)` projects; a season panel
  shows all projects for the team and lets any member set their own active project (or clear it to
  see all projects at once). `src/app/(app)/team/[id]/SeasonPanel.tsx`,
  `add_team_project`/`remove_team_project`/`set_active_project` RPCs.
- **Team page: OnShape credentials** — admin-only form to save a team-wide OnShape API access
  key/secret key; a "Test Connection" button hits the OnShape `documents` endpoint.
  `src/app/(app)/team/[id]/OnshapeCredentials.tsx`, `src/app/actions/onshape.ts`,
  `src/app/api/onshape/test-connection/route.ts`.
- **Assembly list** — all assemblies for the active project (or globally, unscoped) with hierarchy
  indicators, links into each. `src/app/(app)/assemblies/page.tsx`.
- **Create assembly with auto-suggested number** — top-level numbers increment by 100
  (`26_A_100`, `26_A_200`); an inline "next number" API call
  (`src/app/api/next-part-number/route.ts` / `getNextAssemblyNumber` action) pre-fills the form.
  Optional parent-assembly picker for sub-assemblies. `src/app/(app)/assemblies/new/page.tsx`,
  `src/app/actions/assemblies.ts`.
- **Assembly detail page** — shows the assembly's own parts/sub-assemblies, an OnShape sync panel,
  bulk status update, and per-part inline quantity/status editors.
  `src/app/(app)/assemblies/[id]/page.tsx`, `OnshapePanel.tsx`, `BulkStatusUpdate.tsx`,
  `InlineStatusButton.tsx`, `PartQtyEditor.tsx`.
- **Edit / delete assembly** — rename, re-parent, change CAD link; delete cascades (FK
  `on delete cascade`) to parts and BOM items — no "assembly has children" guard like Cheesy Parts.
  `src/app/(app)/assemblies/[id]/edit/`, `DeleteAssemblyButton.tsx`,
  `src/app/actions/assemblies.ts` (`deleteAssembly`, admin-only).
- **Bulk status update across an assembly's whole subtree** — walks the assembly tree via
  breadth-first traversal, updates every part status found and logs one history row per part with
  a shared reason note. `bulkUpdateAssemblyStatus` in `src/app/actions/parts.ts`.
- **Part quantity lock** — per-(part, assembly) `quantity_locked` flag so a manual quantity edit
  survives a future OnShape BOM re-import instead of being overwritten. `toggleQuantityLock` in
  `src/app/actions/parts.ts`, `PartQtyEditor.tsx`.
- **Create part** — manufactured (part number required, format-validated) or off-the-shelf
  (part number optional/absent); creates the part plus its first `bom_items` row (quantity, spare
  quantity) and initial `design_in_progress` status-history row in one action.
  `src/app/(app)/parts/new/page.tsx` (639 lines — the largest single page in the app, with
  extensive client-side naming/format guidance), `src/app/actions/parts.ts` (`createPart`).
- **Part naming-conformance flag** — free-text part names are checked against the expected
  `PP_[AP]_NNN` shape; non-conforming names are flagged (`naming_flagged`) and a corrected
  suggestion is computed via loose regex matching, surfaced in the UI rather than blocking save.
  `checkNamingConformance` in `src/lib/validation.ts`.
- **Part detail page** — full attribute view, status-change form with note, manufacturing-process
  section, assignment picker, OnShape identity/thumbnail. `src/app/(app)/parts/[id]/page.tsx`,
  `UpdateStatusForm.tsx`, `ManufacturingSection.tsx`.
- **Edit part, including multi-assembly membership** — a part can belong to several assemblies at
  once; the edit form lets you add/remove assembly memberships (each with its own BOM
  quantity), re-type manufactured↔off-shelf, and edit COTS fields; a "merge" checkbox folds every
  other part sharing the same OnShape part identity into this one.
  `src/app/(app)/parts/[id]/edit/EditPartForm.tsx`, `updatePart` in `src/app/actions/parts.ts`.
- **Merge two parts explicitly** — pick a source and target part; BOM memberships and OnShape
  identity transfer to the target, source part deleted. `mergeWithExistingPart` in
  `src/app/actions/parts.ts`.
- **Add an existing part to another assembly** — attaches a `bom_items` row without duplicating
  the part row, guarding against a duplicate (part, assembly) pair. `addExistingPartToAssembly`.
- **Delete part** — admin-only, confirmation button. `DeletePartButton.tsx`, `deletePart` action.
- **Part list with filters** — search + status filter + "assigned to me" filter across the active
  project. `src/app/(app)/parts/page.tsx`.
- **Manufacturing queue** — cross-assembly board of every `manufactured`-type part currently in a
  manufacturing-phase status, filterable by free-text search or a specific assembly; each row
  shows assigned processes/vendor and lets a non-viewer inline-advance status.
  `src/app/(app)/manufacturing/page.tsx`, `ManufacturingQueue.tsx`,
  `src/app/actions/manufacturing.ts`.
- **Orders board (COTS purchasing)** — groups every off-the-shelf part in the active project by
  vendor (deduping identical parts across assemblies by name+supplier-PN), shows required + spare
  quantities per line, flags lines missing vendor/supplier-PN info separately, and lets a
  non-viewer mark a whole vendor group ordered/received (cascading to every part line) or toggle
  individual lines. Outsourced *manufactured* parts (flagged in `part_manufacturing.outsourced`)
  get their own per-vendor group in the same board. `src/app/(app)/orders/page.tsx`,
  `OrdersClient.tsx`, `src/app/actions/orders.ts`.
- **Custom vendor list** — teams can save vendor names (typed cots/outsourced/both) that persist
  and autocomplete across parts, beyond a hardcoded default list (West Coast Products, AndyMark,
  REV Robotics, ThriftyBot, Amazon, VEXpro). `src/app/actions/vendors.ts`.
- **OnShape BOM import (initial + diff/re-sync)** — link an assembly to an OnShape assembly URL;
  `sync-diff` fetches the live OnShape BOM, diffs it against local `bom_items` (added/removed/
  changed), and stages the diff in `onshape_sync_diffs` for review; `sync-apply` commits an
  approved diff. `src/app/api/onshape/{import,sync-diff,sync-apply}/route.ts`,
  `src/lib/onshape/bom.ts`.
- **OnShape thumbnail fetch** — pulls a shaded-view render per part for display.
  `src/app/api/onshape/thumbnail/route.ts`, `fetchShadedView` in `src/lib/onshape/client.ts`.
- **OnShape STEP/STL export** — server-side async translation-job flow (submit → poll → download)
  against OnShape's translation API, sidestepping OnShape's redirect-based blob auth by re-signing
  the redirect URL. `src/app/api/onshape/export/route.ts`, `fetchPartStep`/`fetchPartStl` in
  `src/lib/onshape/client.ts`.
- **Help page** — static reference page, publicly accessible without login.
  `src/app/help/page.tsx`.

Not present: no CSV export, no file/attachment upload independent of OnShape, no email
notifications, no audit trail UI beyond the raw `part_status_history` table (no dedicated
history view was found), no automated tests (`package.json` defines no `test` script).

## Integrations

- **OnShape REST API** — the app's signature integration. Custom HMAC-SHA256 API-key client
  (`src/lib/onshape/client.ts`) implementing OnShape's documented auth spec by hand (no SDK): BOM
  fetch (indented/multi-level), document/element listing, shaded-view thumbnails, and STEP/STL
  export via the async translation-job API. Credentials are team-scoped, admin-managed, and stored
  server-side only (`team_onshape_credentials`, isolated RLS policy) — never sent to the browser.
- **Vercel** — implied deployment target per `IMPLEMENTATION_PLAN.md`; no other hosting config in
  the repo.
- **Supabase** — both the Postgres database and the auth provider; no other external identity
  provider (no Google/GitHub OAuth despite Team 1741's own hub using Supabase+OAuth).

## Notable Implementation Details

- **Fake-email username auth.** Real emails are never collected; `login`/`signup` synthesize
  `${username}@frc-part-tracker.local` purely to satisfy Supabase Auth's email/password API. A
  reimplementation wanting real usernames on Supabase Auth would hit the same wall and likely reach
  for the same workaround, or move to a custom `users` table with its own credential check.
  `src/app/actions/auth.ts`.
- **Enum evolution instead of redesign.** `part_status` grew from 5 → 13 values across three
  migrations by `ALTER TYPE ... ADD VALUE` and renaming one value in place
  (`complete` → `manufacturing_complete`), with `UPDATE` statements migrating existing rows forward
  each time. Postgres cannot drop enum values, so the type permanently carries dead labels; any
  code (or a rewrite) reading raw enum values must handle historical values that no longer appear
  in the UI. `supabase/migrations/20260519000000_phase5_status.sql`,
  `20260523000000_phase_based_statuses.sql`.
- **`bom_items` as the many-to-many join, not a `parts.assembly_id` FK alone.** A part has one
  "primary" `assembly_id` on the `parts` row (used for its canonical detail-page URL) but can carry
  additional `bom_items` rows pointing at other assemblies it's also used in — `updatePart`
  reconciles the full membership set (add/remove/update) from a multi-select form field on every
  save. `src/app/actions/parts.ts` (`updatePart`).
- **Merge-by-OnShape-identity.** Because OnShape assemblies can reference the same underlying part
  from multiple contexts, re-importing a BOM can create duplicate `parts` rows for what is really
  one physical part. The app detects this via matching `(onshape_element_id, onshape_part_id)` and
  offers both an automatic "merge" checkbox on edit and an explicit merge action.
  `mergeWithExistingPart`/`updatePart` in `src/app/actions/parts.ts`.
- **RLS helper functions instead of repeated subqueries.** `my_team_id()`/`my_role()` (both
  `security definer stable` SQL functions) are called from inside every policy's `USING` clause,
  keeping each policy a one-liner instead of re-deriving the caller's team/role per table.
  Team 1741's hub, on the same Supabase/Next.js stack, could adopt the identical pattern directly.
  `supabase/migrations/20260506000000_initial_schema.sql`.
- **Security-definer RPCs carry all cross-cutting writes.** Every operation that needs to bypass a
  user's own RLS scope (creating a team on signup, joining by code, changing another member's
  role, saving OnShape secrets) is a dedicated Postgres RPC, not a service-role client call from
  the Next.js server — keeping privilege escalation logic auditable in SQL migrations rather than
  application code.
- **OnShape binary-export redirect re-signing.** OnShape's file-download endpoints redirect to a
  separate blob host; forwarding the original HMAC `Authorization` header to the redirect target
  fails (signed for the wrong path), so `apiFetchBinary` intercepts the 3xx response and re-signs a
  fresh request for the redirect URL. `src/lib/onshape/client.ts`.
- **Project scoping by string range, not a project FK.** Assemblies/parts don't carry a
  `project_code` column; "belongs to project 26A" is inferred by querying
  `assembly_number >= '26A_' AND assembly_number < '26A\x60'` (using the byte after `_` as an
  exclusive upper bound) everywhere a page needs to scope to the active project — repeated in the
  dashboard, orders, and manufacturing pages rather than centralized in one query helper.
  `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/orders/page.tsx`,
  `src/app/(app)/manufacturing/page.tsx`.
- **No test suite, no CI.** `package.json` has no `test` script; no `.github/workflows` directory.
  A `.claude/` directory and `IMPLEMENTATION_PLAN.md`/`AGENTS.md` indicate the project itself was
  built AI-agent-assisted, consistent with the compressed 19-day, ~900-commit-message-free build
  timeline visible in the single-branch history.
