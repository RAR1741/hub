# CircuitRunners PO Management — Source Survey

**Repo:** smahapatra2718/circuitrunner-po-management — https://github.com/smahapatra2718/circuitrunner-po-management
**Surveyed-at:** 57d9975b37c1964c5935e813059dd431c98c683b
**Permalink form:** https://github.com/smahapatra2718/circuitrunner-po-management/blob/57d9975b37c1964c5935e813059dd431c98c683b/<path>
**Stack:** React 18 + TypeScript + Vite, Tailwind CSS, React Router, Firebase (Firestore + Auth + Storage), Firebase Cloud Functions v2 (Node/TypeScript, `onDocumentWritten` trigger) with Nodemailer/SMTP for email, XLSX for Excel import, React Hook Form, date-fns
**License:** none (all rights reserved) — no LICENSE file in the tree and `license` is null via the GitHub API; ideas only, do not copy code.
**Last activity:** 2026-04-03 (pushed_at)
**FRC team:** CircuitRunners robotics organization (README: "for CircuitRunners robotics organization"; login restricted to `@circuitrunners.com` emails) — specific team number not identifiable from the repo
**Areas:** parts ordering/POs (primary)

## Purpose
A purchase-order and budget-tracking web app for a robotics org with multiple sub-teams ("sub-organizations"). Directors submit POs against a sub-org budget, admins approve/decline with budget-impact visibility, and purchasers execute approved purchases and reconcile bank/credit-card transactions against POs — replacing spreadsheet-based PO tracking with a workflow that also emails stakeholders at each status change.

## Auth & Roles
- **Firebase Authentication** (email/password), domain-restricted to `@circuitrunners.com` per README; `src/components/auth/Login.tsx`, `src/config/firebase.ts`.
- **Role model**: primary `role` field (`director | admin | purchaser | guest`) plus an optional `roles: []` array for multi-role users (`src/types/index.ts`). `AuthContext` (`src/contexts/AuthContext.tsx`) exposes `hasRole()` / `getAllRoles()` that check both the primary role and the array.
- **Guest mode**: `loginAsGuest()` sets a client-only synthetic "guest" profile (no Firebase Auth session) for read-only browsing — see `GuestDashboard.tsx`, `GuestAllPOs.tsx`, `GuestTransactions.tsx`.
- **Server-side enforcement** via Firestore Security Rules (`firestore.rules`), not just client-side route guards:
  - `users/{userId}`: self or admin read/write.
  - `subOrganizations`: public read; admin write, or purchaser write restricted to not changing `budgetAllocated` (a field-level rule, `request.resource.data.budgetAllocated == resource.data.budgetAllocated`).
  - `purchaseOrders`: public read; create restricted to director/admin; update allowed to the creator only while status is `draft`/`declined` (and only transitioning to `draft`/`pending_approval`), or to admin (approve/decline) or purchaser (only from `approved`/`pending_purchase`); delete allowed to any authenticated user (no ownership check — a gap for a re-implementer to note).
  - `transactions`: public read; write restricted to purchaser/admin.
  - `auditLogs`: read for authenticated users, `write: if false` (server-only, though no Cloud Function in this repo actually writes to it — the collection is dead in code but rule-protected).
- Role resolution helper duplicated in Cloud Functions (`functions/src/index.ts` `allRoles()`/`hasRole()`) for email-recipient lookups, mirroring the client logic.

## Data Model
Firestore collections (`src/types/index.ts`):
- `users/{userId}`: `email`, `displayName`, `role`, `roles?`, `createdAt`.
- `subOrganizations/{orgId}`: `name`, `budgetAllocated`, `budgetSpent`, `initialBudget`, `credit`.
- `purchaseOrders/{poId}`: `name`, `creatorId/creatorName`, `organizations: POOrganization[]` (multi-org allocation superseding legacy single `subOrgId/subOrgName`), `status` (`draft|pending_approval|approved|declined|pending_purchase|purchased`), `lineItems: LineItem[]` (vendor, itemName, subcategory mechanical/electrical, category consumable/part/misc, sku, qty, unitPrice, link, notes, totalPrice), `totalAmount`, `organizationAllocations`, `adminComments`, `purchaserComments`, `overBudgetJustification`, approval/purchase actor+timestamp fields, `receiptUrl`.
- `transactions/{transactionId}`: `postDate`, `description`, `debitAmount`, `status`, `allocations: TransactionAllocation[]` (split across sub-orgs, superseding legacy single `subOrgId`), `receiptUrl/receiptFileName`, `notes`, `poLinks: POLink[]` (a transaction can be linked to multiple POs with amount/percentage each, superseding legacy single `linkedPOId`).
- `userNotificationPrefs/{userId}`: `readNotifications: {[notificationId]: boolean}` — read-state for the synthetic notification feed (see below).
- `auditLogs/{logId}`: typed (`entityType/entityId/action/userId/userEmail/timestamp/details`) but unused by any writer in the current codebase.
- Migration helper `src/utils/transactionMigration.ts` exists to move data from the legacy single-allocation/single-PO-link shape to the new split/multi shape, evidence of an in-place schema evolution.

## Features

**Purchase order management**
- Multi-stage workflow `draft → pending_approval → approved/declined → pending_purchase → purchased`, enforced partly in Firestore rules and partly in UI (`src/services/poService.ts`, `src/components/po/*`).
- PO creation with line items, per-line vendor/product links, quantity × unit price auto-totaling, category/subcategory tagging, and over-budget justification field (`src/components/po/CreatePO.tsx`).
- Multi-organization allocation per PO (`POOrganization`/`POAllocation`) — a single PO's cost can be split across several sub-orgs by percentage/amount.
- Role-scoped list views: `MyPOs.tsx` (creator's own), `PendingApproval.tsx` (admin queue), `PendingPurchase.tsx` (purchaser queue), `AllPOs.tsx` (admin/full visibility), `GuestAllPOs.tsx` (read-only public view).
- `PODetailsModal.tsx` for viewing/editing a PO's full detail, comments, and status history.
- Composite-index Firestore queries with automatic in-memory fallback + sort when the index isn't deployed (`getPOsByUser`, `getPOsByStatus` in `poService.ts`) — a defensive pattern worth reusing to avoid hard failures on missing indexes.
- `src/utils/poFilters.ts` / `poLineItemDisplay.ts` — shared filter/sort and line-item rendering helpers used across list views.

**Budget management**
- Per-sub-org budget tracking: `budgetAllocated`, `budgetSpent`, `initialBudget`, `credit` (`src/components/budget/BudgetManagement.tsx`, `src/services/subOrgService.ts`).
- `recalculateAllBudgets()` (`transactionService.ts`) recomputes every sub-org's `budgetSpent` from the full transaction set (supporting both legacy single-suborg and new split-allocation transactions), writing only sub-orgs whose spent total actually changed (>$0.01 delta) to minimize writes.
- Budget-threshold alerts baked into the notification generator (75/90/100%+ style tiers, see Notifications below).

**Transaction management**
- Excel/XLSX bulk upload of bank/credit-card statements (`src/components/transactions/Transactions.tsx`, `processExcelData` in `transactionService.ts`): filters to `status === 'posted'` rows with a positive debit and non-empty description, tolerant multi-format Excel-serial/string date parsing (`parseExcelDate`), and skips rows whose `description` already exists in Firestore (naive dedupe key — description text only, not date+amount, so identical recurring line items could either double-skip or double-count depending on which comes first).
- Transaction-to-PO linking, including many-to-many via `poLinks[]` with per-link amount/percentage (`src/components/transactions/POLinkingModal.tsx`).
- Per-transaction allocation across sub-orgs (`allocations: TransactionAllocation[]`) with automatic percentage computation.
- Receipt upload/download to Firebase Storage (`uploadReceiptFile`/`deleteReceiptFile` in `transactionService.ts`), with URL-based storage-path extraction for deletion.
- Guest read-only transaction view (`GuestTransactions.tsx`).

**Notifications**
- Client-computed (not stored) notification feed built each load from recent POs/transactions/sub-orgs (`src/services/notificationService.ts`): role-specific generators for director (status changes on own POs in the last 2h, critical budget alerts), admin (pending-approval count, budget alerts, recent transaction uploads in last 4h), purchaser (POs ready for purchase with running dollar total, recently-purchased POs needing receipts in last 24h).
- Read/unread state persisted per-user in `userNotificationPrefs/{userId}.readNotifications` map (`markNotificationAsRead`/`markAllNotificationsAsRead`).
- Priority tiers (high/medium/low) and icon/action-URL metadata for a bell-dropdown UI (`src/components/layout/NotificationDropdown.tsx`).

**Email notifications (server-side, Firebase Cloud Function)**
- `onPurchaseOrderWrite` (`functions/src/index.ts`), an `onDocumentWritten` trigger on `purchaseOrders/{poId}`, diffs before/after `status` and sends templated HTML emails via Nodemailer/SMTP (configured through `SMTP_HOST/PORT/USER/PASS/FROM/SECURE` env vars, with a diagnostic logger when vars are missing) for three transitions:
  - → `pending_approval`: notifies all admins+purchasers (deduped, creator excluded).
  - → `approved`: notifies staff (admin+purchaser) plus a separate email to the creator, both listing who approved and the total.
  - → `purchased`: notifies the creator only.
- Recipient lists are resolved per-send by scanning the whole `users` collection and role-matching (`loadRecipientEmails`) — fine at small team scale, would need a lookup index at larger scale.

**Admin**
- `UserManagement.tsx` — presumably admin CRUD over user role assignment (component present; role changes ultimately land in `users/{uid}.role`/`.roles`).

**Dashboard**
- `Dashboard.tsx` / `dashboardService.ts` — aggregate view (budget utilization, pending/recent PO activity) per README screenshots; `GuestDashboard.tsx` mirrors it for unauthenticated/guest viewers.

**Misc UI/infra**
- Reusable `ui/` primitives: `Badge`, `Button`, `Card`, `Modal` (+ `useModal` hook), `CookieConsent`, `LocalStorageNotice`.
- `Layout.tsx` / `Sidebar.tsx` / `Header.tsx` — role-aware nav shell.

## Integrations
- **Firebase** (Firestore, Auth, Storage, Cloud Functions) as the entire backend — not a third-party team-ops integration but the whole platform dependency.
- **SMTP email** via Nodemailer in the Cloud Function (any SMTP provider; no specific vendor hardcoded) — see Email Notifications above.
- No Slack/Discord/TBA/Onshape/GitHub integrations present; "vendor links" on line items are just freeform URLs entered by the user, not a real vendor API integration.

## Notable Implementation Details
- **Backward-compatible schema migration in place**: types and services carry both the old single-value fields (`subOrgId`, `linkedPOId`) and new array-based fields (`organizations[]`, `poLinks[]`, `allocations[]`) simultaneously, with a dedicated `transactionMigration.ts` utility — a real example of migrating a live Firestore schema without a hard cutover.
- **Composite-index fallback pattern**: several list queries (`poService.ts`) try an indexed `where + orderBy` query first and catch to a simpler `where`-only query with in-memory sort, so the app degrades gracefully instead of erroring when a Firestore composite index hasn't been deployed yet.
- **Notifications are computed, not stored**: the notification feed is regenerated from source data on every load rather than persisted as documents; only read/unread flags are persisted (in a per-user map, not per-notification documents), which keeps writes cheap but means notification history isn't queryable and time-windowed items (e.g., "last 2 hours") silently disappear once the window passes.
- **Transaction dedupe is description-text-only** (`checkTransactionExists`) — no compound key with date/amount, so a legitimately repeated identical charge on a different date could be skipped as a false duplicate.
- **`purchaseOrders` delete rule has no ownership/role restriction** (`allow delete: if request.auth != null;`) — any authenticated user can delete any PO; likely an oversight worth fixing in any re-implementation.
- **Guest mode is fully client-side** (no Firebase Auth session, no server-verified guest role) — relies entirely on Firestore rules' `allow read: if true` on public collections; guests get read-only components but nothing server-side distinguishes "real anonymous" from "guest UI state."
- **Auth domain restriction (`@circuitrunners.com`) is not visible in the reviewed rules/code** as an enforced check (README claims it, but Firestore rules only require `request.auth != null`) — likely enforced only via Firebase Console email-domain allowlist or manual account provisioning, not in application logic.
- Excel date parsing (`parseExcelDate`) handles the classic Excel 1900-leap-year serial-date bug explicitly — a reusable snippet for any Excel-import feature.

## Verdict
Substantive and directly on-target: a real multi-role PO/budget/transaction workflow with a working approval state machine, split budget allocations, Excel reconciliation, and event-driven email notifications via a Cloud Function — worth mining for the status-transition email trigger pattern, the composite-index-fallback query pattern, and the legacy-to-split-allocation migration approach. No LICENSE file, so treat as ideas-only, no code reuse.
