# REV Parts Pit — Source Survey

**Repo:** robogreg/REV_parts_tracker — https://github.com/robogreg/REV_parts_tracker
**Surveyed-at:** b6c4686fc0ef8fc711aece35dec8e6fa845ba8ff
**Permalink form:** https://github.com/robogreg/REV_parts_tracker/blob/b6c4686fc0ef8fc711aece35dec8e6fa845ba8ff/<path>
**Stack:** Next.js 16 (App Router) + TypeScript, Tailwind CSS 4, Firebase Auth + Cloud Firestore (Admin SDK server-side), Dexie.js (IndexedDB) for offline queue, Zustand, TanStack Query v5, PapaParse (CSV), next-pwa, deployed to Google Cloud Run via Cloud Build.
**License:** none (no LICENSE file present in the tree) — all rights reserved; ideas only.
**Last activity:** 2026-04-28 (pushed_at)
**FRC team:** not a team tool — built by REV Robotics (vendor) for its own staff to run at FRC/FTC/FLL events. Not team-specific.
**Areas:** (5) parts ordering/POs — inventory distribution & checkout/audit tracking is the entire app; (3) third-party integrations — FIRST Inspires API (FRC+FTC) and BigCommerce catalog import are first-class features.

## Purpose
A mobile-first PWA REV Robotics staff use at competition pits to check out spare parts to teams, track loaners, and keep an audit trail — with offline-first operation for unreliable venue WiFi. It is a vendor-side "swag/spares counter" POS, not a team-internal tool, but the checkout/inventory/audit/offline patterns are directly reusable for a team's own pit/build-season parts crib.

## Auth & Roles
- Firebase Authentication, Google OAuth restricted to `@revrobotics.com` accounts (`firestore.rules` `isRevUser()` checks `request.auth.token.email.matches('.*@revrobotics\\.com')`).
- Firestore security rules are coarse: any authenticated REV user has read/write on all collections (`events`, `inventory`, `teams`, `transactions`, `parts`, `adminLogs`) — no per-document ownership checks.
- API-route-level role gating is finer-grained, in `lib/api-helpers.ts`: `requireAuth()` verifies the Firebase ID token server-side and checks the email domain; `requireManager()` additionally requires a stored Firestore user record with role `manager`/`superadmin`; `requireSuperAdmin()` hardcodes a single allowed email (`greg@revrobotics.com`) for the Settings page (API credential management).
- `isAdmin`/role flags on `users/{uid}` must be set manually in Firestore — no self-service promotion UI.

## Data Model
Firestore collections (see `REV_PARTS_PIT_SPEC.md` §4 and `lib/types.ts`):
- `events/{eventId}` — `RevEvent`: name, program (FRC/FTC/FLL/OTHER), location, date range, status (setup/active/closed), optional link to a FIRST API event code/season.
- `parts/{partId}` — global catalog `Part`: sku, category, packSize/packUnit, defaultLoaner, msrp, tags — shared across events.
- `events/{eventId}/inventory/{itemId}` — `InventoryItem`: denormalized embed of the `Part` plus event-scoped `quantityAvailable`/`quantityGiven` (remaining computed), `isLoaner` override, `lowStockThreshold`.
- `events/{eventId}/teams/{teamId}` — roster entries (team number/name/program/location/school).
- `transactions/{transactionId}` — root-level (not nested under events, to allow cross-event queries) checkout records: line items (`TransactionItem` with partId/qty/unitType/isLoaner/loanerReturned), team + contact info, staff email, timestamps, offline `syncStatus`.
- `firstEventsCache/{program_season}` — server-side 24h TTL cache of FIRST API event lists.

## Features

### Parts distribution / checkout (area 5)
- Tablet-first POS-style checkout UI: category-filtered/searchable parts grid, quantity steppers, per-item loaner toggle — `components/checkout/PartsGrid.tsx`, `components/checkout/PartCard.tsx`, `components/ui/QuantityControl.tsx`.
- Cart/slide-in panel with per-row loaner marking — `components/checkout/CartPanel.tsx`, `components/checkout/CartItem.tsx`.
- Pack-size aware SKUs: a `-pk25` suffix SKU offers "individual" vs "pack of N" checkout options, parsed from the SKU string — `lib/rev-api.ts` `parsePackSize()`, `lib/csv-parser.ts` pack_size column.
- Checkout modal capturing team number, contact name/email, optional reason before committing a transaction — `components/checkout/CheckoutModal.tsx`, `app/api/transactions/route.ts`.
- Custom (non-catalog) part entry at checkout time — `components/checkout/CustomPartCard.tsx`.
- Team search/autocomplete against the event's imported roster — `components/checkout/TeamSearch.tsx`.
- Multi-event switcher (bottom sheet) so staff can flip between concurrently-active events on one device — `components/checkout/EventSwitcher.tsx`.
- Low-stock warning with staff override to still dispense — surfaced via `lowStockThreshold` on `InventoryItem`.
- Loaner return workflow: admin marks a loaned item returned, updating `loanerReturned`/`loanerReturnedAt` on the transaction — `components/admin/LoanerReturnModal.tsx`, `app/api/transactions/[id]/route.ts` (PATCH).

### Admin / inventory & audit (area 5)
- Events CRUD + live per-event stats (transactions count, parts given, loaners outstanding) — `app/(app)/admin/events/*`, `components/admin/StatsCards.tsx`.
- Inventory table with inline quantity/threshold editing, loaner toggle, bulk delete via row checkboxes — `components/admin/InventoryTable.tsx`, `app/api/events/[id]/inventory/route.ts`.
- Reports page: filterable transaction log (by team/staff/event), loads recent transactions by default without requiring an event filter first, CSV export — `app/(app)/admin/reports/page.tsx`, `components/admin/TransactionTable.tsx`, `app/api/transactions/route.ts`.
- Generic CSV bulk uploader shared by inventory and teams import flows, with per-row validation errors surfaced to the admin (missing sku/name/team_number, bad numeric fields) — `components/admin/CsvUploader.tsx`, `lib/csv-parser.ts`.
- Admin dashboard stats/reporting uses Recharts.

### Third-party integrations (area 3)
- **FIRST Inspires API client** (`lib/first-api.ts`): unified FRC + FTC support against `frc-api.firstinspires.org` and `ftc-api.firstinspires.org` v2.0, HTTP Basic auth (base64 user:token), built-in fallback credentials with env-var override, pagination handling, and tolerance for FRC/FTC response-shape differences (upper/lowercase keys). Server-side 24h Firestore cache (`firstEventsCache`) to avoid re-hitting the API. Used to import an event's registered team roster (`app/api/events/[id]/teams/first/route.ts`) and to list/search FIRST events (`app/api/first/events`, `app/api/first/teams`).
- **REV BigCommerce catalog import** (`lib/rev-api.ts`): pulls the full REV product catalog via BigCommerce's v3 REST API, paginates categories and products, excludes internal/hidden/discontinued categories and `OLD-`-prefixed SKUs, strips HTML from descriptions, and derives pack size from SKU suffix. Config falls back from env vars to a Firestore-stored settings doc if unset. Exposed via `app/api/events/[id]/inventory/rev/route.ts` and an admin Settings "test connection" button.
- CSV import/export for both inventory and teams as a vendor-agnostic fallback to the two live integrations.

### Offline support (cross-cutting)
- Dexie/IndexedDB-backed queue (`lib/offline.ts`): `RevPartsDatabase` with `pendingTransactions`, `cachedEvents`, `cachedInventory`, `cachedTeams` tables; 30-minute cache TTL for read-through caching of events/inventory/teams so the checkout UI keeps working with stale-but-usable data offline.
- Transaction submission always writes to the local queue first; `syncPendingTransactions()` replays the queue against `POST /api/transactions` with retry counting (marks `failed` after 3 attempts) and dispatches a `rev-sync-complete` DOM event for the UI banner to pick up.
- Client-generated transaction IDs (`offlineId`) prevent duplicate submission across retries.
- `components/ui/OnlineDetector.tsx` / `SyncBanner.tsx` surface connectivity state and pending-sync count to the user.
- Installable PWA via `next-pwa` (manifest, service worker) for tablet/kiosk-style installs.

## Integrations
FIRST Inspires API (FRC + FTC), REV Robotics' own BigCommerce storefront API, Firebase/Firestore (as both DB and auth), Google Cloud Run/Cloud Build for deploy. No Slack/Discord/email/SMS integration.

## Notable Implementation Details
- Denormalization pattern worth stealing: `InventoryItem` embeds the full `Part` object rather than joining, so the checkout UI never needs a second read per item — trades storage/consistency risk for read simplicity, appropriate for a catalog that changes rarely mid-event.
- Transactions are stored at Firestore root (not nested under `events/{id}`) specifically to allow cross-event reporting queries — a deliberate anti-nesting choice worth calling out when designing a similar audit log.
- API credentials have a three-tier fallback: env var → Firestore-stored setting → hardcoded built-in default (for the FIRST API keys specifically, with a comment noting they deliberately do NOT fall through to a possibly-bad stored value, to avoid recurring 401s). A re-implementer should keep the env-var-wins precedence but skip baking real credentials into source.
- Firestore security rules are intentionally coarse (single domain-check function gates all collections) — finer authorization (manager/superadmin) is enforced only in Next.js API routes via `lib/api-helpers.ts`, not in the Firestore rules themselves. This is a real gap if any client code writes to Firestore directly instead of going through the API.
- CSV parsing normalizes headers (`trim().toLowerCase().replace(/\s+/g,'_')`) so uploaders don't need exact column casing, and collects per-row errors with 1-indexed+header row numbers for clean user-facing messages — a reusable pattern for any admin bulk-import feature.
- `next dev --webpack` — the app pins the Webpack (not Turbopack) build path in `package.json` scripts.

## Verdict
Substantive and directly relevant despite being vendor- rather than team-authored: the checkout/loaner/audit workflow, offline-first Dexie queue with retry/dedup, FIRST API dual-program client with caching, and BigCommerce catalog importer are all concrete, well-scoped patterns worth recreating for a team's own parts-crib or pit-inventory tool. No LICENSE file, so treat as ideas-only, not copyable code.
