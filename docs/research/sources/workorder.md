# FRC Work Order System — Source Survey

**Repo:** WinnerWang971119/workorder — https://github.com/WinnerWang971119/workorder
**Surveyed-at:** 5abe588fffa8557b2de641d8edc4e7cd15d68ff3 (get via: gh api repos/WinnerWang971119/workorder/commits --jq '.[0].sha')
**Permalink form:** https://github.com/WinnerWang971119/workorder/blob/5abe588fffa8557b2de641d8edc4e7cd15d68ff3/<path>
**Stack:** TypeScript monorepo (pnpm workspaces): discord.js 14 bot, Next.js 14 (App Router) web dashboard, shared types package, Supabase Postgres (RLS + pg_cron)
**License:** MIT (LICENSE file present) — free to reuse/adapt directly, not just ideas-only
**Last activity:** 2026-02-12 (pushed_at)
**FRC team:** unknown (repo has no team-number identifier; described only as "for FRC teams")
**Areas:** design/manufacturing tracking (primary — work-order creation/assignment/claiming for build tasks), communication (Discord-native workflow)

## Purpose
Lets an FRC team create, assign, claim, and close out build-season tasks ("work orders") entirely from Discord slash commands and buttons, with a companion Next.js web dashboard for analytics, guild/subsystem configuration, and full audit history. Distinct from a purchasing/PO tool — it tracks *manufacturing/build task* lifecycle (who claimed a machining job, when it was finished), not parts spend.

## Auth & Roles
- **Discord bot side:** no bot-level login; permission is derived per-command by fetching the invoking member's Discord roles and checking them against `guild_configs.admin_role_ids` (`packages/bot/src/services/permission.service.ts`). Two effective roles: `ADMIN` (configured admin roles) and `MEMBER` (everyone else) — see `packages/shared/src/types/permissions.ts`.
- **Permission rules, enforced per-action** (`permission.service.ts`):
  - Edit: creator or admin (`canEditWorkOrder`)
  - Remove: admin only (`canRemoveWorkOrder`)
  - Assign: admin only (`canAssignWorkOrder`)
  - Claim: anyone, unless already claimed by someone else (`canClaimWorkOrder`)
  - Cancel: creator or admin (`canCancelWorkOrder`)
  - Unclaim: the claimer themselves or admin (`canUnclaimWorkOrder`)
  - Finish: claimer or admin (inline check in `packages/bot/src/commands/wo-finish.ts`)
- **Web dashboard side:** Discord OAuth via Supabase Auth (`packages/web/app/auth/callback/route.ts`, `packages/web/app/login/page.tsx`); `packages/web/lib/permissions.ts` mirrors the same admin/member role-ID comparison for server actions (`packages/web/lib/actions/workorder-actions.ts`).
- DB-level RLS is mostly `USING (true)` for reads with permission enforcement pushed to the application layer; only service-role and creator/admin can write (`supabase/migrations/002_rls_policies.sql`).

## Data Model
(`supabase/migrations/001_initial_schema.sql`, `004_add_subsystems.sql`, `006_cancel_and_notifications.sql`, `009_add_cleared_at_and_cron.sql`; types in `packages/shared/src/types/workorder.ts`)

- **users** — `discord_user_id` (unique), `display_name`, `avatar_url`, `last_seen_at`; upserted on first bot interaction (`packages/bot/src/services/user.service.ts`).
- **guild_configs** — one row per Discord server: `admin_role_ids[]`, `member_role_ids[]`, `work_orders_channel_id` (where cards get posted), `timezone`.
- **subsystems** — guild-scoped, admin-editable replacement for a hardcoded category enum (added in migration 004): `name`, `display_name`, `emoji`, `color`, `sort_order`. Migration includes a data-migration script that seeds default MECH/ELECTRICAL/SOFTWARE/GENERAL subsystems per guild and backfills existing work orders' `category` into `subsystem_id`, then drops the old `category` column entirely.
- **work_orders** — `title`, `description`, `subsystem_id` (FK, RESTRICT), `status` (`OPEN`/`DONE`/`CANCELLED`), `priority` (`LOW`/`MEDIUM`/`HIGH`), `created_by_user_id` (RESTRICT — creator can't be deleted while WO exists), `assigned_to_user_id`/`claimed_by_user_id` (SET NULL), Discord message/channel/thread/guild IDs for card tracking, `is_deleted`, `cleared_at` (bulk-clear grace period), `cad_link`, `notify_user_ids[]`/`notify_role_ids[]` (who gets @mentioned).
- **audit_logs** — immutable (`actor_user_id` RESTRICT, no UPDATE/DELETE policy) append-only trail: `guild_id`, `work_order_id`, `actor_user_id`, `action` enum (`CREATE`/`EDIT`/`REMOVE`/`ASSIGN`/`CLAIM`/`UNCLAIM`/`STATUS_CHANGE`/`CANCEL`/`CLEAR`/`RECOVER`), `meta` JSONB, `created_at`.

## Features

### Discord bot (build-task lifecycle)
- `/wo-create` — title, subsystem, description, priority, optional CAD link, optional single-user/single-role `@mention` notification targets; posts a color-coded embed "card" to the guild's configured work-orders channel and gives the creator a jump-link (`packages/bot/src/commands/wo-create.ts`).
- `/wo-claim` / `/wo-unclaim` and matching **interactive buttons** on the posted card (`packages/bot/src/buttons/claim-button.ts`, `unclaim-button.ts`) — first-come-first-claimed, blocked if already claimed by someone else.
- `/wo-finish` and **Mark Done button** (`mark-done-button.ts`) — only the claimer or an admin can close it; updates the card in place and logs a `STATUS_CHANGE`.
- `/wo-assign` (admin-only) — assigns to a specific `@user`, resolving/creating their DB user record, updates card, logs `ASSIGN`.
- `/wo-edit` (creator or admin) — updates title/description/etc., re-renders the card.
- `/wo-remove` (admin-only) — soft-deletes (`is_deleted=true`), logged as `REMOVE`.
- `/wo-cancel` via **cancel button** (`packages/bot/src/buttons/cancel-button.ts`) — distinct `CANCELLED` status vs. soft-delete, for tasks abandoned rather than finished.
- `/wo-list` — lists open, non-deleted work orders for the guild, joined with subsystem display data.
- Priority-driven embed coloring and emoji (🟢/🟡/🔴) and a derived three-state display status (Unclaimed / Claimed / Finished) computed client-side from `status` + `claimed_by_user_id` (`packages/shared/src/constants.ts` `getDisplayStatus`/`getEmbedColor`).
- Every mutating action writes to `audit_logs` via a single `logAction()` helper (`packages/bot/src/services/audit.service.ts`), giving a uniform, guaranteed audit trail rather than ad hoc logging per command.

### Web dashboard
- Discord OAuth login (`packages/web/app/login/page.tsx`, `auth/callback/route.ts`).
- Work order list with status/category filtering and detail view showing full audit history (`packages/web/app/workorders/page.tsx`, `app/workorders/[id]/page.tsx`).
- Usage analytics/leaderboard page (`packages/web/app/usage/page.tsx`).
- **Admin panel** (`packages/web/app/admin/page.tsx`):
  - Guild configuration: admin/member role-ID lists, work-orders channel ID, with a dropdown to switch between multiple configured guilds.
  - **Subsystem CRUD**: create/edit/delete/reorder (up/down swap of `sort_order`) subsystems per guild, with emoji + color picker; delete is blocked at the DB level (FK RESTRICT) if a subsystem is still referenced by any work order, surfaced as a friendly error rather than a raw constraint failure.
  - **Danger Zone — two-phase bulk clear**: admin selects one or more statuses (OPEN/DONE/CANCELLED), types `CLEAR` to confirm, bulk soft-deletes matching work orders and stamps `cleared_at`; a 24-hour recovery window is shown with a live countdown, and a single **Recover** button restores everything cleared. A Supabase `pg_cron` job (`supabase/migrations/009_add_cleared_at_and_cron.sql`, job `hard-delete-cleared-work-orders`, runs hourly) permanently hard-deletes rows whose `cleared_at` is >24h old and still `is_deleted`. Documented as a full implementation plan at `docs/plans/2026-02-06-danger-zone-clear-workorders.md`.
  - Light/dark theme toggle (`components/theme-toggle.tsx`, `theme-provider.tsx`).

## Integrations
- **Discord** (primary and only external integration) — discord.js 14 bot with slash commands, interactive buttons, and an embed "card" UI that stays in sync between Discord and the web dashboard (`packages/bot/src/services/discord.service.ts`, `packages/web/lib/discord-bot.ts`, `discord-api.ts`).
- No Onshape/TBA/Slack/email/SMS integration.

## Notable Implementation Details
- **Category → subsystem migration pattern worth stealing**: migration 004 shows a clean playbook for turning a hardcoded enum column into an admin-editable, guild-scoped lookup table without breaking existing rows — seed defaults per guild, backfill by name match, fallback-to-GENERAL for orphans, only then add NOT NULL and drop the old column/constraint. Directly reusable if this app's own category fields (e.g. task/part categories) ever need to become user-configurable.
- **Two-phase soft-delete with pg_cron auto-hard-delete** (grace-period clear/recover) is a clean, generically reusable pattern for any "bulk clear with an undo window" feature — the whole plan document (`docs/plans/2026-02-06-danger-zone-clear-workorders.md`) is a good template for the shape of such a plan (schema → server actions → UI → build/commit checkpoints).
- **RLS is deliberately permissive** (`USING (true)` on most SELECT policies) with all real authorization pushed into application code (`permission.service.ts` on the bot, `lib/permissions.ts`/server actions on the web) — a pragmatic but security-relevant tradeoff to note if recreating: RLS alone does not protect this schema; the app-layer checks are load-bearing.
- Card/embed re-render is centralized (`discordService.updateWorkOrderCard`) so every mutating command (`assign`, `finish`, `claim`, etc.) keeps the Discord message visually in sync with DB state — avoids drift between the posted card and actual status.
- Audit logging is a single shared helper (`logAction`) called from every service mutation, guaranteeing no action silently skips the trail — worth mirroring over having each command hand-roll its own log insert.
- Small scale: single guild-per-work-order model, no pagination visible on `/wo-list` or the dashboard list — would need attention if adopted at higher volume.

## Verdict
Substantive and directly relevant: a small but real, MIT-licensed, fully-featured build-task lifecycle system (create/assign/claim/finish/cancel with audit trail) distinct from parts purchasing. Worth stealing: the category-to-configurable-table migration pattern, the two-phase clear/recover-with-cron design, and the centralized audit-log-per-mutation + Discord-card-sync patterns.
