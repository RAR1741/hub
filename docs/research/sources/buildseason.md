# BuildSeason — Source Survey

**Repo:** ncssm-robotics/buildseason — https://github.com/ncssm-robotics/buildseason
**Surveyed-at:** 45eee65fc7d24694d2e8255fe96e884b7216586a
**Permalink form:** https://github.com/ncssm-robotics/buildseason/blob/45eee65fc7d24694d2e8255fe96e884b7216586a/<path>
**Stack:** TypeScript, Convex (backend/db/functions/scheduler), React + TanStack Router (frontend, "secondary interface"), Bun runtime, Convex Auth (OAuth), Claude (Anthropic SDK) as the agent, Resend (email), Discord API (bot + webhooks)
**License:** none (all rights reserved) — no LICENSE file present in the tree; ideas only
**Last activity:** 2026-02-01 (repo `pushed_at`); latest surveyed commit dated 2026-01-19
**FRC team:** unknown — this is an FTC-labeled tool (`program: "ftc"` in schema) built by NCSSM Robotics; no specific team number identifiable in the code (team number is a user-entered field per-team, e.g. `ftc-5064` used as an example)
**Areas:** (1) time/attendance — partial (event RSVP only, no clock-in/hours), (2) people/rosters — yes, (3) third-party integrations — yes (Discord, Resend email, OAuth, Claude/Anthropic), (4) communication — yes (Discord bot as primary interface, email notifications), (5) parts ordering/POs — yes, (6) part design/manufacturing tracking — no (BOM/inventory only, no CAD/manufacturing workflow)

FTC-comparable tool, explicitly labeled as such throughout this survey.

## Purpose

An "agent-first" team management platform for FTC teams where a Discord bot persona ("GLaDOS", built on the Claude Agent SDK) is the primary interface for inventory, purchasing, BOM, and team-status questions, with a React web app as a secondary/administrative surface. It targets the operational grind of running a robotics team: parts tracking, purchase-order approval workflow, vendor management, and youth-protection-compliant member/mentor administration.

## Auth & Roles

- **Auth:** Convex Auth (`@convex-dev/auth`) with OAuth providers Discord, GitHub, and Google (`convex/auth.ts`). A `providerProfiles` table supplements the auth tables with provider username/avatar/email, including an async GitHub-username-lookup action.
- **Roles:** Three-tier hierarchy stored per `teamMembers` row: `lead_mentor` (3) > `mentor` (2) > `student` (1), with legacy `"admin"` normalized to `lead_mentor` for backwards compatibility (`convex/lib/permissions.ts`).
- **Enforcement:** Centralized helpers — `requireAuth`, `requireTeamMember`, `requireRole(ctx, teamId, requiredRole)`, `hasRole` — used consistently across every mutation/query in `members.ts`, `teams.ts`, `orders.ts`, `parts.ts`, `bom.ts`, `vendors.ts`, `invites.ts`. Every table row carries `teamId`, and every handler re-derives permission from the authenticated user + team membership rather than trusting client-supplied role claims.
- **Youth Protection Program (YPP) compliance layer:** `convex/lib/ypp.ts` computes age from a stored `birthdate`, gates team creation and "YPP contact" designation to adults (`isAdult`), and a team must always retain at least one YPP contact and one lead mentor (guards in `teams.ts`/`members.ts` block removing the last one of each).

## Data Model

Convex schema (`convex/schema.ts`), all tables indexed by `teamId` where relevant:

- `users` (extends Convex Auth's table with `birthdate` for YPP), `teamMembers` (user↔team, role, personal context: dietary needs, observances, free-text notes), `teamInvites` (token-based, expiring), `providerProfiles`, `discordLinks` / `discordLinkTokens` (Discord user ↔ BuildSeason user linking)
- `teams` (program/number/name, `activeSeasonId`, `discordGuildId`, `yppContacts` array), `seasons`
- `vendors` (global, shared across all teams — name/domain/support contacts) and `teamVendors` (per-team junction: account number, lead time, preferred flag, notes) — a global-vendor + team-override pattern
- `parts` (inventory: qty, reorderPoint, unitPriceCents, location, vendor link, full-text search index on name) and `bomItems` (part × subsystem × quantityNeeded, computes shortage vs. current stock)
- `orders` (status state machine: draft→pending→approved/rejected→ordered→received; totals, rejection reason, createdBy/approvedBy) and `orderItems` (line items)
- `events` (competition/outreach/meeting/practice/other, date/location, RSVP toggle) and `eventAttendees` (going/maybe/not_going)
- `inboundEmails` (forwarded vendor emails parsed by an LLM into vendor/order/tracking/line-items), `agentConfig`, `conversations` (per-channel rolling history), `agentAuditLogs` (append-only compliance log of every agent turn + tool calls), `safetyAlerts` + `alertAckTokens` (mentor-notification/acknowledgment flow for concerning content), `birthdayMessages` (dedup log for automated birthday shoutouts)

## Features

**People / rosters**
- Role-gated member list, role change, and removal with a "can't remove the last lead mentor" guard — `convex/members.ts`
- Self-service and mentor-editable personal context fields (dietary needs, observances, free-text notes) surfaced to the agent for "personalization" — `convex/members.ts`, referenced in `convex/agent/prompts/`
- Token-based team invites with role pre-assignment and 7-day expiry, emailed via Resend — `convex/invites.ts`, `convex/email/send.ts` (`sendTeamInvite`)
- YPP-compliant team creation (creator must be an adult) and YPP-contact management (add/remove, cannot drop below one) — `convex/teams.ts`, `convex/lib/ypp.ts`
- Provider-profile enrichment (GitHub username backfill via a scheduled action) — `convex/auth.ts`, `convex/providers/actions.ts`
- Automated birthday detection (leap-year-safe Feb 29 handling) and personalized Discord shoutouts, deduplicated per team per day — `convex/birthdays.ts`

**Time/attendance-adjacent**
- Event calendar with types (competition/outreach/meeting/practice/other) and optional RSVP requirement — `convex/schema.ts` (`events`)
- RSVP tracking (going/maybe/not_going) per event/user — `eventAttendees` table (no dedicated `convex/events.ts` query/mutation file was inspected beyond the schema/routes; frontend route at `src/routes/team/$program.$number/index.tsx` likely surfaces it)
- No clock-in/out or hours-logging — this app has RSVP-style attendance, not shift/hours tracking

**Parts ordering / POs**
- Inventory CRUD with reorder-point, unit price, location, image, and a Convex full-text search index — `convex/parts.ts`
- Low-stock query (`getLowStock`) driving proactive alerts — `convex/parts.ts`
- Deletion guarded against parts still referenced by orders or BOM — `convex/parts.ts` (`remove`)
- Purchase-order lifecycle: draft → submit → approve/reject (mentor+) → markOrdered → markReceived (auto-increments part quantities on receipt) — `convex/orders.ts`
- Order-status notification emails (approved/rejected/ordered/received) — `convex/email/send.ts` (`sendOrderNotification`)
- Vendor directory: global vendor records shared platform-wide, with per-team overrides (account number, lead time, preferred flag) merged at read time — `convex/vendors.ts`
- **Inbound email → structured order data pipeline:** teams forward vendor emails to `ftc-{number}@buildseason.org`; a Resend webhook (Svix HMAC-verified, replay-protected) stores the raw email, then a Claude Haiku agent extracts vendor/order-number/tracking/line-items/total from the body — `convex/email/inbound.ts`, `convex/email/extraction/parser.ts`, `convex/email/extraction/schema.ts`
- Auto-creates/updates the global vendor record and team-vendor junction (account number) from data extracted out of inbound emails — `convex/email/inbound.ts` (`findOrCreateVendor`)
- (Order↔email auto-linking by order number/tracking is stubbed with a TODO — schema lacks `vendorOrderNumber`/`trackingNumber` fields on `orders` yet.)

**BOM / manufacturing tracking**
- BOM items link a part to a subsystem with quantity-needed and computed shortage (needed − current stock) — `convex/bom.ts`
- Grouped-by-subsystem view and team-wide shortage report — `convex/bom.ts` (`listBySubsystem`, `getShortages`)
- No CAD/design-file tracking or manufacturing-step workflow — BOM is inventory-linkage only, not a part-design/manufacturing tracker

**Communication**
- Discord bot as the primary UX: `/glados` and `/ask` slash commands, Ed25519-signature-verified webhook, deferred response + async follow-up — `convex/discord/handler.ts`, `convex/discord/respond.ts`
- Discord-account linking (OAuth-native or manual token flow prompted on first bot use) — `convex/discord/links.ts`, `convex/discordLinkTokens` table
- LLM agent (Claude Sonnet, via `@anthropic-ai/sdk` directly, not just Convex's agent component) with a tool-calling loop (max 10 iterations), team-scoped tool access (BOM/orders/parts/members/events/discord queries), and native web-search tool — `convex/agent/handler.ts`, `convex/agent/tools/*`
- Pre-screening/moderation pass on every inbound message for youth-safety risk classification, with three outcomes: pass through, flag-and-alert-mentor, or block-and-return-neutral-response — `convex/agent/moderation.ts`
- Mentor safety-alert pipeline: Discord DM + email notification, "click to acknowledge" token-based links, escalation tracking, and severity levels — `safetyAlerts`/`alertAckTokens` tables, `convex/email/send.ts` (`sendMentorAlert`), `src/routes/alert-ack.tsx`
- Append-only agent audit log (every user message, agent response, tool calls with in/out/error, and whether it tripped a safety alert) for compliance review — `convex/agentAuditLogs`, `convex/agent/auditLog.ts`
- Transactional email for invites, order status, and mentor alerts via Resend, with HTML-escaping helper applied to all interpolated user content — `convex/email/send.ts`

## Integrations

- **Discord** — bot commands, webhook interactions (signature-verified), guild channel lookup/posting via bot token, account-linking flow — `convex/discord/*`
- **Resend** (email) — outbound transactional email (`@convex-dev/resend` component) and inbound email webhook for vendor order/shipping emails (Svix-signed) — `convex/email/*`
- **Anthropic Claude** — the core agent runtime (`claude-sonnet-4-20250514` for chat, a Haiku-class model for structured email extraction), used directly via the Anthropic SDK rather than a Convex Agent framework — `convex/agent/handler.ts`, `convex/email/extraction/parser.ts`
- **OAuth** — Discord, GitHub, Google login via Convex Auth — `convex/auth.ts`
- **Native web search** — Claude's `web_search_20250305` server tool wired into the agent's tool list — `convex/agent/handler.ts`

## Notable Implementation Details

- **Global vendor + per-team override pattern**: `vendors` is a single shared table across all teams (contact info extracted from real vendor emails benefits every team), while `teamVendors` holds only the team-specific slice (account number, lead time, preferred flag). Worth stealing directly for any multi-tenant parts/ordering feature — avoids every team re-entering the same vendor's support email.
- **LLM-based email parsing instead of regex/vendor-specific parsers**: inbound vendor emails are handed to a small/cheap Claude model with a JSON schema rather than hand-rolled per-vendor parsers — explicitly justified in code comments as more robust to new vendors and able to use mentor-supplied context ("only the usb cam was for 5064"). A generalizable idea, though it adds an LLM-cost and non-determinism dependency for what could partly be regex/heuristic-based.
- **Youth Protection Program (YPP) is a first-class compliance concern**, not an afterthought: age-gating on team creation, mandatory YPP-contact minimum, and a full agent-side content moderation/escalation pipeline (block vs. flag vs. pass, mentor DM+email alerts with ack tokens, escalation counts). Directly relevant prior art for any FTC/FRC tool handling minors' data or unsupervised comms with students.
- **Discord signature verification done from scratch** with `tweetnacl` (Ed25519) for interaction webhooks and a hand-rolled Svix HMAC-SHA256 verifier (with 5-minute replay-window check) for Resend's inbound-email webhook — both in `convex/discord/handler.ts` / `convex/email/inbound.ts`, useful reference code for verifying either webhook type.
- **Order status machine and BOM shortage math are simple and defensive**: strict status-transition guards (`Can only approve pending orders`, etc.), and deletion guards preventing removal of parts referenced by orders/BOM.
- **Agent audit logging is separate from conversation history**: `conversations` holds rolling context for multi-turn agent replies; `agentAuditLogs` is an append-only, indexed-by-team/user/timestamp compliance trail including raw tool call I/O and a safety-alert flag — a good separation-of-concerns pattern if building any agent-mediated ops tool that needs audit trails distinct from working memory.
- **TODOs/gaps flagged in-code**: automatic email→order linking is stubbed pending schema fields; a 90-day inbound-email retention/cleanup job is noted as not yet implemented.
- Repo ships a large `.claude/` directory (custom skills/commands for AI-assisted development of the repo itself) — not part of the product, irrelevant to feature survey.

## Verdict

Substantive and directly relevant (FTC-comparable): a real purchase-order lifecycle, global/per-team vendor model, BOM-with-shortage-calc, YPP-aware roster/role management, and an unusually thorough Discord-first communication + safety-escalation layer. No LICENSE file, so treat as ideas-only. Most worth stealing: the global-vendor/team-override schema split, the LLM-based inbound-email-to-structured-order pipeline, and the YPP compliance/escalation pattern (age-gating, mandatory YPP contacts, moderation-then-alert-then-ack flow) for any tool handling minor students.
