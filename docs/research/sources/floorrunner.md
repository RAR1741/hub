# FloorRunner — Source Survey

**Repo:** jSydorowicz21/FloorRunner — https://github.com/jSydorowicz21/FloorRunner
**Surveyed-at:** bfa2e1c21584185de9d73d04b7b4fd2a698a64b3 (get via: gh api repos/jSydorowicz21/FloorRunner/commits --jq '.[0].sha')
**Permalink form:** https://github.com/jSydorowicz21/FloorRunner/blob/bfa2e1c21584185de9d73d04b7b4fd2a698a64b3/<path>
**Stack:** Next.js 14 (App Router, TypeScript), Supabase (Postgres + Auth + Realtime + Storage), Tailwind CSS, @dnd-kit for drag-and-drop
**License:** none — no LICENSE file present, `license` field is `null` in repo metadata. All rights reserved; ideas only, do not copy code.
**Last activity:** 2026-05-23 (single-day burst; created and last pushed same date)
**FRC team:** unknown (not FRC-related; this is a commercial CNC machine shop SaaS)
**Areas:** (6) part design/manufacturing tracking — job/work-order tracking on a shop floor, comparable to a build-season parts-fabrication tracker. Generic CNC shop tool, not FRC-specific.

## Purpose
A small multi-tenant SaaS for CNC machine shops to track jobs (work orders) from quoting through completion, break each job into sequential machine operations, assign operators/machines, log time, and give customers a no-login "magic code" portal to check job status. Directly comparable to what an FRC team would want for tracking fabrication of robot parts across machines/operators/stations.

## Auth & Roles
- Supabase Auth: email/password, magic link, and GitHub OAuth (per README); `src/app/auth/login`, `src/app/auth/signup`, `src/app/auth/callback/route.ts`.
- Session refresh via Next.js middleware: `src/middleware.ts` → `src/lib/supabase/middleware.ts` (`updateSession`).
- Server helpers `src/lib/auth.ts`: `getUser()`, `requireUser()` (throws on unauthenticated), `signOut()`.
- Two roles only: `owner` and `operator` (`user_role` enum). Owner-only actions gated by RLS policies (e.g. writing machines/customers/settings, managing team) rather than app-level checks in most routes — most API routes just check "is a user logged in," not role.
- Customer portal (`/portal/[code]`) is deliberately unauthenticated — a shareable code substitutes for login, scoped by RLS to `portal_codes`/read-only job visibility.
- Multi-tenant isolation is by `shop_id` foreign key + RLS policies scoping every table to the caller's shop (`supabase/migrations/001_initial_schema.sql`), not a separate tenant framework.

## Data Model
10 tables (`supabase/migrations/001_initial_schema.sql`):
- `shops` — tenant/account root; `plan` enum (free/starter/pro/shop), `stripe_customer_id` (billing groundwork, unused in app code).
- `users` — shop-scoped app users (operators + owner), `role`, `is_active`, `last_active_at` (drives an "active in last hour" stat).
- `machines` — shop floor equipment; `status` enum (running/idle/down/maintenance), `status_note`, `sort_order`.
- `customers` — shop's clients.
- `jobs` — the work order: `job_number` (auto-generated `JOB-YYYY-NNNN`), `part_number`, `part_description`, `quantity`, `due_date`, `quoted_price`, `status` enum (quoting/scheduled/in_progress/complete/cancelled), `priority` (normal/rush), `current_operation_id` FK back to `job_operations`.
- `job_operations` — ordered steps within a job (`operation_number`, unique per job), each with a `machine_id`, `operator_id`, `status` (pending/in_progress/complete), `started_at`/`completed_at`, `est_minutes`.
- `operation_time_entries` — time log per operation/operator, `entry_type` (timer/manual/system), `duration_minutes`.
- `job_notes` — threaded notes on a job with `note_type` (general/issue/update/internal/customer) — the `customer` type implies portal-visible notes vs internal ones.
- `job_photos` — photo attachments per job/operation, `photo_type` (setup/part/qc/other), stored via Supabase Storage bucket `job-photos`.
- `shop_settings` — generic key/value settings store per shop.
- `portal_codes` — customer magic-link tokens, `code_hash` unique, joined to `customer_id`.
- Postgres triggers: auto-`updated_at` maintenance, and `prevent_owner_deletion` (blocks deactivating the last active owner of a shop).
- `generate_job_number(shop_id)` Postgres function computes the next sequential job number per shop per year.

## Features
**Part design/manufacturing tracking (core, area 6):**
- Kanban job board with 4 columns (Quoting → Scheduled → In Progress → Complete) and drag-and-drop status changes via @dnd-kit — `src/app/board/page.tsx`, `src/components/board/StatusColumn.tsx`, `src/components/board/CreateJobModal.tsx`.
- Realtime board updates via Supabase Postgres Changes subscription on the `jobs` table (falls back to full refetch on any change) — `src/app/board/page.tsx`.
- Job detail page with per-job operation list, notes, and photos — `src/app/jobs/[id]/page.tsx`, `src/components/jobs/JobCard.tsx`, `src/components/jobs/OperationRow.tsx`.
- Job CRUD + status transitions as both REST routes and Next.js Server Actions (duplicated logic) — REST: `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`; Server Actions: `src/app/actions/index.ts` (`createJob`, `updateJob`, `updateJobStatus`, `deleteJob`).
- Auto job-numbering (`JOB-YYYY-NNNN`) via a Postgres RPC call from both the REST route and the server action — `src/app/api/jobs/route.ts` (POST), `src/app/actions/index.ts` (`createJob`).
- Sequenced job operations per job, each assignable to a machine + operator, with completion tracking — `src/app/api/jobs/[id]/operations/route.ts`, `src/app/api/operations/[id]/route.ts`, `src/app/api/operations/[id]/complete/route.ts`, `completeOperation` action.
- Job notes with typed categories (general/issue/update/internal/customer) — `src/app/api/jobs/[id]/notes/route.ts`, `createNote` action.
- Machine roster and status board (running/idle/down/maintenance) — `src/app/machines/page.tsx`, `src/app/machines/[id]/page.tsx`, `src/app/machines/new/page.tsx`, `src/app/api/machines/route.ts`, `src/app/api/machines/[id]/route.ts`.
- Shop dashboard stats (active/completed jobs, machines on floor, active operators in the last hour) — `src/app/api/stats/route.ts`.
- Job search/filter by status and part description — `src/app/api/jobs/route.ts` (`status`, `search` query params, `ilike` on `part_description`).

**People/rosters (area 2):**
- Team management page + API to list/update operators (name, role, active flag) — `src/app/team/page.tsx`, `src/app/api/team/route.ts`, `src/app/api/team/[id]/route.ts`, `updateOperator` action.
- Operator invite flow via Supabase Admin `generateLink({type:'invite'})` — `inviteOperator` in `src/app/actions/index.ts`.
- DB-level guard preventing removal of a shop's last owner (`prevent_owner_deletion` trigger).

**Time tracking (adjacent to area 1, applied to work not attendance):**
- Per-operation time entries (timer/manual/system) recorded against an operator — `operation_time_entries` table; no dedicated route seen in the tree, likely written directly from client via Supabase client SDK.

**Customer-facing / portal:**
- Shareable customer portal at `/portal/[code]` — no login required, shows the customer's own jobs and operations read-only — `src/app/portal/[code]/page.tsx`, `src/app/api/portal/[code]/route.ts`, `src/app/api/portal/generate/route.ts`, `generatePortalCode` action.

**Shop config:**
- Shop settings page backed by the generic `shop_settings` key/value table — `src/app/settings/page.tsx`.

## Integrations
- Supabase (Auth, Postgres, Realtime, Storage) is the only backend — no Onshape/TBA/Slack/Discord/email/SMS integration code found.
- Stripe: only a dangling `stripe_customer_id` column on `shops` and a `plan_type` enum; no Stripe API calls anywhere in the code — billing is unimplemented scaffolding.
- GitHub OAuth via Supabase Auth (README mentions it; not confirmed in a route file beyond the generic `auth/callback`).

## Notable Implementation Details
- **"Portal code hashing" is not real hashing** — `code_hash` is produced with `btoa(code)` (base64), which is trivially reversible/guessable, in both `src/app/api/portal/generate/route.ts` and `generatePortalCode` in `src/app/actions/index.ts`. A re-implementation should use a real HMAC/random token + proper hash (e.g. SHA-256) if adopting the magic-code portal idea.
- Business logic is duplicated between REST API routes (`src/app/api/**/route.ts`) and Server Actions (`src/app/actions/index.ts`) doing near-identical Supabase calls (e.g. job creation, operation completion) — a maintenance smell to avoid copying wholesale; pick one call pattern.
- Multi-tenancy is enforced entirely through Postgres RLS policies keyed off `auth.uid()` joined against `users.shop_id`, rather than application-layer tenant checks — clean pattern worth reusing, but note the `portal_public_read` policy on `portal_codes` is `USING (true)` (fully public table read), relying solely on the guessable-code weakness above for security.
- Job numbering is generated inside a Postgres function (`generate_job_number`) using a regex-based max-sequence scan per shop/year — fine at small scale, would need a sequence/lock at higher concurrency (race between concurrent inserts is possible since the SELECT-then-INSERT isn't in one atomic statement/transaction advisory lock).
- Realtime is enabled on only 3 tables (`jobs`, `job_operations`, `machines`) via `ALTER PUBLICATION supabase_realtime ADD TABLE` — the board simply refetches the whole job list on any change rather than patching state, simple but not scalable to large job counts.
- Very small codebase (~65 files, single day of commits per repo metadata) — a prototype/demo more than a production system; no tests, no CI config found in the tree.

## Verdict
Substantive and directly relevant for area 6 (part/manufacturing tracking) — a clean, small reference for a job/operations/machine data model, Kanban board with realtime, and a no-login customer portal pattern; steal the RLS-per-tenant approach and the job-number/operation-sequencing schema shape, but reimplement portal-code hashing properly and avoid the REST+Server-Action logic duplication.
