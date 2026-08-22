# Cacao — Source Survey

**Repo:** frc-2064/cacao — https://github.com/frc-2064/cacao
**Surveyed-at:** f84254ddf9af7a5e6288ff4336e814aa76710d25
**Permalink form:** https://github.com/frc-2064/cacao/blob/f84254ddf9af7a5e6288ff4336e814aa76710d25/<path>
**Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, Tailwind CSS v4 (hand-written Material 3 Expressive layer), Convex (reactive backend/DB), Vercel hosting; optional local-only mode with no backend (localStorage + seed data)
**License:** none — repo has no LICENSE file (`license: null` via GitHub API). Ideas only, all rights reserved.
**Last activity:** 2026-08-20 (pushed_at)
**FRC team:** FRC Team 2064, "The Panther Project" (Region 15)
**Areas:** (5) parts ordering/POs — primary focus (expense/purchase request lifecycle); also touches (3) third-party integrations (Hack Club Bank) and (2) people/rosters (student access + graduation lifecycle)

## Purpose
A small internal ops tool for a team's business/mentor side: track grant applications through a submission pipeline, manage sponsor/donor relationships and outreach cadence, log purchase/expense requests from request through reimbursement, log income deposits, and gate student access to the tool itself. Explicitly framed as a replacement for "messy Google Sheets."

## Auth & Roles
No real authentication is implemented in this snapshot — there is no OAuth/session/JWT check anywhere in the `convex/*.ts` mutations. Every mutation takes `actorName`/`actorEmail`/`actorRole` as plain client-supplied arguments (`convex/validators.ts` `actorArgs`) and trusts them for audit-log attribution; nothing server-side verifies the caller is who they claim. Role model is four literals: `admin` (mentor), `student`, `viewer`, `graduated` (`convex/schema.ts` `users.role`). "Access control" in the UI is client-side gating (e.g. `src/lib/components/admin/AdminPanel.svelte` is only linked/shown for admins) plus an access-request workflow:
- Students submit a request (`submitAccessRequest` in `convex/users.ts`) via `src/lib/components/auth/RequestAccessModal.svelte`, because `@region15.org` student emails can't receive external magic links (per README).
- An optional shared "mentor passcode" (`cacao.verifyMentorPasscode`) lets a student self-approve in person without waiting on a mentor, bypassing the queue entirely (`RequestAccessModal.svelte`).
- Mentors approve/deny from a queue (`approveAccessRequest` / `rejectAccessRequest` in `convex/users.ts`), assigning a role at approval time.
- Batch graduation: `graduateClassBatch` flips every user in a `gradYear` to role/status `graduated` in one mutation.

This is worth flagging as an anti-pattern to avoid copying: client-asserted identity/role with no server verification is fine for a small trusted-team demo but not something to carry into a real re-implementation without adding real auth (e.g. Convex Auth / session-verified identity).

## Data Model
Convex schema (`convex/schema.ts`), 8 tables:
- **grants** — funding opportunities: title, funder, amount/currency, `status` (backlog→drafting→awaiting_approval→submitted→awarded/rejected), deadline (+ type: fixed/rolling/tbd), assignee, priority, season, portal/doc URLs, `requirements` (embedded checklist array), kanban `order`, audit fields (`createdAt/updatedAt/lastModifiedBy`). Indexed by status, season, assignee.
- **sponsors** — CRM entity: category (corporate/local_business/foundation/community_partner/in_kind_supplier), tier (platinum/gold/silver/bronze/panther_partner/in_kind/none), status (lead→…→paid_active/declined/stale_renewal_due), `totalDonated`, `currentYearPledge`, `annualHistory` (embedded per-year outreach/pledge array), primary contact fields. Indexed by tier, status.
- **contacts** — people linked to a sponsor (`sponsorId`), with preferred contact method, `lastContactedAt`. Indexed by sponsor.
- **users** — team roster: role, gradYear, subteam, status (active/pending/graduated/rejected), approval metadata. Indexed by email.
- **accessRequests** — pending student sign-up requests awaiting mentor review. Indexed by status.
- **auditLogs** — immutable append-only log: actor (name/email/role), `action` enum (create/update/delete/status_change/assign/requirement_toggle/approve_user/reject_user/graduate_batch/outreach_logged/import_seed), entityType (grant/sponsor/contact/user/system), entityId/Name, summary, optional `details`. Indexed by timestamp.
- **expenses** — purchase/reimbursement requests (see Features below for full lifecycle fields). Indexed by status, season, subteam.
- **incomeDeposits** — manual deposit log: category (fundraiser/donation/merch_sales/bottle_can_drive/camp_registration/sponsorship_check/other_income), depositAccount (hcb_bank/school_account/cash_box), season. Indexed by category, account, season.

`convex/lib.ts` centralizes `logAudit()` so every mutation writes a uniform audit row, and `usd()` for formatting audit summaries.

## Features

### Parts ordering / POs (primary area)
- **Full expense/purchase lifecycle** (`convex/expenses.ts`, `src/lib/components/expenses/`): `pending_approval → approved → purchased → reimbursed` (or `rejected`), with dedicated mutations per transition (`approve`, `purchase`, `recordPurchase`, `markDelivered`, `reimburse`, `remove`) each writing its own audit entry.
- **Purchase-detail capture at time of buy** (`recordPurchase` in `convex/expenses.ts`, `src/lib/components/expenses/MarkPurchasedModal.svelte`): final paid amount (may differ from requested amount), payment method (`hcb_card`/`personal_reimbursement`/`school_po`/`grant_voucher`/`cash`/`other`), purchaser name, order number, tracking number, carrier (UPS/FedEx/USPS/Amazon/DHL/Local Pickup/Other), expected delivery date, receipt URL.
- **Delivery/shipment tracking**: `deliveryStatus` enum (`ordered`/`shipped`/`delivered`) separate from the approval `status`, with a one-click "mark delivered" mutation (`markDelivered`) that stamps `receivedAt` — i.e. it tracks both money-status and physical-shipment-status as independent state machines on the same record.
- **Expense categorization**: robot_parts/electronics/tools/travel/registration/food/media/general, plus `subteam` tagging and `season` scoping.
- **Grant-linked spending**: expenses can reference `linkedGrantId`/`linkedGrantTitle` to tie a purchase back to the grant that funded it.
- **List/filter UI** (`src/lib/components/expenses/ExpensesList.svelte`, `ExpenseModal.svelte`, `LogDepositModal.svelte`).
- **Manual income/deposit logging** (`convex/income.ts`, `LogDepositModal.svelte`): separate ledger for fundraiser/donation/merch/bottle-drive/camp-fee/sponsorship-check income, tagged to a deposit account (HCB bank / school account / cash box).

### Third-party integrations
- **Hack Club Bank (HCB) treasury sync** (`src/lib/components/expenses/HCBTreasuryCard.svelte`, referenced via `cacao.hcbOrg`/`cacao.hcbTransactions`/`cacao.syncHackClubBank()` in the store): pulls live cash balance, lifetime raised total, authorized cardholders/mentors, and the 10 most recent transactions (credit/debit, memo, date, user) from HCB, with a manual "Sync" button and a link out to the org's HCB dashboard. This is the concrete example of a nonprofit-banking API integration for FRC teams — HCB is a Hack-Club-run fiscal-sponsorship/debit-card platform many teams already use.

### Grants pipeline (funding side, adjacent to POs)
- **6-column kanban board** (`src/lib/components/grants/GrantsKanban.svelte`) with drag-and-drop status transitions, per-column dollar totals and counts, requirement-checklist progress bars, deadline urgency, assignee avatars, and quick links to drafting docs / submission portals.
- **Sortable table view** with CSV export (`src/lib/components/grants/GrantsTable.svelte`, `src/routes/grants/table/+page.svelte`).
- **Requirement checklists** embedded per grant, toggled with their own audit action (`requirement_toggle`).

### Sponsor/donor CRM (adjacent — funding intake, not POs)
- **Tiered sponsor list** (Platinum/Gold/Silver/Bronze/Panther Partner/In-Kind) with multi-year outreach history matrix and pledge/received tracking (`src/lib/components/sponsors/SponsorsList.svelte`, `SponsorModal.svelte`, `LogOutreachModal.svelte`).
- **Stale-contact detection**: flags sponsors with no outreach logged in >9 months so annual renewals aren't missed (status `stale_renewal_due`).
- **Contacts directory** linked to sponsors, with click-to-email/call affordances (`src/lib/components/contacts/`).

### People/rosters
- **Student access request + mentor approval queue** (`convex/users.ts`, `AdminPanel.svelte`, `RequestAccessModal.svelte`) — see Auth & Roles.
- **In-person mentor passcode** shortcut for instant self-verification at meetings.
- **Batch class graduation** (`graduateClassBatch`) — archives a whole grad-year cohort to alumni status in one action while preserving audit history.

### Cross-cutting
- **Full audit log** (`convex/audit.ts`, surfaced in `AdminPanel.svelte`): every create/update/delete/status-change/assign/approval/graduation/outreach/seed-import action, filterable by entity type.
- **Financial overview/analytics** (`src/lib/components/analytics/FinancialsView.svelte`, `/analytics` route) — aggregates grants + expenses + income + sponsor totals.
- **Local-only demo mode**: with no `PUBLIC_CONVEX_URL` set the entire app runs on `localStorage` seeded from `src/lib/data/seedData.ts` — same store interface (`src/lib/stores/cacaoStore.svelte.ts`) as the live Convex-backed mode, so components are agnostic to which backend is active. Notable pattern for a "works offline / zero-setup demo" mode.
- **Full JSON backup export** (`AdminPanel.svelte` `exportFullBackup()`) — dumps grants/sponsors/contacts/users/auditLogs to a downloadable JSON file, client-side only.
- **One-click seed/reset** (`resetToSeedData()`) — wipes and reloads Team 2064's real starter data (named real sponsors/grants), a bootstrap-only destructive action gated behind a confirm dialog.

## Integrations
- **Hack Club Bank (HCB)** — treasury/banking sync (balance, transactions, authorized users) — the standout integration for this survey's purposing, since it's a real nonprofit banking API many FRC teams use for their accounts.
- Google Docs / arbitrary "submission portal" URLs are referenced only as plain link fields on a grant (`docUrl`, `portalUrl`), not an API integration.
- No Slack/Discord/SMS/email-sending integration present in this snapshot; "Google SSO" is described in the README as the intended request-access mechanism but no actual OAuth code exists in the tree surveyed — it's a stated future/partial feature, not implemented.

## Notable Implementation Details
- **Every mutation writes its own audit row server-side** (`logAudit` helper in `convex/lib.ts`), so history is complete regardless of which client made the change — a clean pattern worth reusing regardless of stack.
- **Optimistic-write store with authoritative reconciliation**: `cacaoStore.svelte.ts` updates local state immediately on user action, then fires the Convex mutation; the next live-subscription snapshot overwrites local state, so a failed write self-corrects and toasts. Good pattern for a reactive-DB-backed SPA.
- **Two-mode single store**: the same store class/interface serves both the Convex-backed live mode and a pure-localStorage demo mode, so UI components never branch on which backend is active — useful pattern for a demo-able, zero-backend-setup tool.
- **Client-trusted actor/role fields** (see Auth & Roles) is the main gotcha — don't copy this trust model into a real system; it's fine only because the whole app sits behind a private, already-trusted network of a small team.
- **`deliveryStatus` and purchase `status` are separate small state machines on the same expense row** — worth stealing as a modeling choice: approval workflow and physical-shipment workflow don't have to be the same enum.
- Convex's reactive query model gives free live-updating UI (kanban board, treasury card) without any manual polling/websocket code — notable if evaluating Convex as a backend for a similar internal tool.

## Verdict
Substantive and directly relevant to the parts-ordering/PO gap: it's a real, currently-used, well-structured expense/purchase-request lifecycle (request → approve → purchase-with-shipment-tracking → reimburse) plus a genuinely useful HCB banking integration and a clean audit-log pattern — worth stealing the state-machine modeling (separate delivery vs. approval status, requirement checklists, season/subteam tagging) and the audit-log-on-every-mutation convention; skip/rebuild its auth model, since role/identity are entirely client-asserted with no server verification. No license file, so treat as ideas-only.
