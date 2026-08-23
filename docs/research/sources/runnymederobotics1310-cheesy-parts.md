# Cheesy Parts (Runnymede) — Source Survey

**Repo:** RunnymedeRobotics1310/cheesy-parts — https://github.com/RunnymedeRobotics1310/cheesy-parts
**Surveyed-at:** 979bad82160f4e6ceef2ae8711665d76116be3a2
**Permalink form:** https://github.com/RunnymedeRobotics1310/cheesy-parts/blob/979bad82160f4e6ceef2ae8711665d76116be3a2/<path>
**Stack:** React 18 + TypeScript + Vite + Tailwind CSS + React Router + TanStack Query (frontend); Hono (TypeScript) on Cloudflare Workers (backend/API); PostgreSQL via Supabase (DB, accessed only through `@supabase/supabase-js` service-role client — no RLS policies relied on); deployed to Cloudflare Pages + Workers via GitHub Actions.
**License:** BSD-2-Clause (`COPYING`, copyright Team 254, 2013) — permissive, but per project ground rules this survey recreates concepts only, no code copied.
**Last activity:** 2026-02-02 (pushed_at)
**FRC team:** Originally FRC Team 254 (2013), modernized/maintained by FRC Team 1310 (Runnymede Robotics), per README.
**Areas:** (5) parts ordering/POs, (6) part design/manufacturing tracking. Also touches (2) people/rosters minimally (user accounts/roles) as a supporting mechanism, not a roster feature in its own right.

## Purpose
A rewrite of the classic Team 254 "Cheesy Parts" tool: it tracks CAD parts and assemblies through a manufacturing pipeline (design → material → machining/outsourcing/finishing → assembly → done) with auto-assigned part numbers for CAD file naming, and tracks purchasing — vendor orders, order line items, cost accounting, and reimbursement status — per project (i.e., per build season).

## Auth & Roles
- Custom auth, not Supabase Auth: users table stores `password_hash`/`salt` (PBKDF2-SHA256, 100,000 iterations, `backend/src/index.ts:41-65`), login issues a custom HMAC-signed bearer token (`generateToken`/`verifyToken`, `backend/src/index.ts:94-164`) valid 14 days, embedding `userId:permission:expiresAt` signed with an `AUTH_SECRET`.
- Three permission levels stored on the user row: `readonly`, `editor`, `admin` (`canEdit`/`canAdmin` helpers, `backend/src/index.ts:232-238`); most mutating routes gate on `canEdit`, user management gates on `canAdmin`.
- Global Hono middleware enforces bearer-token auth on every route except `/auth/*` and `/health` (`backend/src/index.ts:196-222`); frontend has a `ProtectedRoute` wrapper (`frontend/src/components/ProtectedRoute.tsx`).
- Self-registration flow: new accounts are created `enabled: false` and `permission: readonly` pending admin approval (`backend/src/index.ts:414-488`); an optional admin-notification email is sent via Resend on registration, and (implied by `buildApprovalEmailHtml`) on approval.
- Password policy enforced server-side: 8+ chars, upper+lower+digit (`validatePassword`, `backend/src/index.ts:77-83`).
- Login rate limiting via a Cloudflare Workers rate-limit binding: 5 attempts/60s per IP (`backend/wrangler.toml` `LOGIN_RATE_LIMITER` binding).
- Security headers middleware sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` on every response (`backend/src/index.ts:175-182`).

## Data Model
(`database/migrations/001_initial_schema.sql`, `002_add_settings.sql`)
- **users** — email/password_hash/salt, first/last name, `permission` enum, `enabled` flag.
- **projects** — name, `part_number_prefix`, `hide_dashboards` flag (one project = one season/robot).
- **parts** — belongs to a project; self-referential `parent_part_id` (assembly/sub-part tree); `type` (`part`|`assembly`); integer `part_number`; `status` enum spanning the whole manufacturing pipeline (`designing`, `material`, `ordered`, `drawing`, `ready`, `cnc`, `laser`, `lathe`, `mill`, `printer`, `router`, `manufacturing`, `outsourced`, `welding`, `scotchbrite`, `anodize`, `powder`, `coating`, `assembly`, `done`); `priority` (0/1/2); `source_material`, `have_material`, `quantity`, `cut_length`, `drawing_created`, `notes`.
- **orders** — belongs to a project; `vendor_name`; `status` (`open`|`ordered`|`received`); `ordered_at`; `paid_for_by` (purchaser name); `tax_cost`/`shipping_cost`; `reimbursed` flag; `notes`.
- **order_items** — belongs to a project and optionally an order (nullable `order_id` = "unclassified" cart item); `quantity`, `part_number` (free-text vendor SKU, distinct from the `parts` table), `description`, `unit_cost`, `notes`.
- **settings** — single-row app-wide config (`hide_unused_fields` toggle).
- Composite index `(project_id, type, part_number)` supports the part-numbering scheme's max-lookup query.

## Features

### Part design/manufacturing tracking (area 6)
- Hierarchical part/assembly tree per project with auto part numbering: assemblies increment by 100 off the highest existing assembly number (`.../projects/:projectId/parts` POST, `backend/src/index.ts:1030-1043`); parts number sequentially under their parent (or off the parent's own number if no siblings yet) (`backend/src/index.ts:1006-1029`) — replicates the original Cheesy Parts numbering convention (`PREFIX-A-100`, `PREFIX-P-1`, etc., per `README.md` "Part Numbering" section).
- 19-state manufacturing status pipeline (design → material → various machine/process stations → assembly → done) with a dedicated quick-update endpoint (`PATCH /parts/:id/status`, `backend/src/index.ts:1115-1143`) separate from the general part-edit endpoint, for fast status-board interactions.
- Kanban-style dashboard grouping all non-done parts by status for a project (`GET /projects/:projectId/dashboard`, `backend/src/index.ts:1183-1231`; UI at `frontend/src/pages/DashboardPage.tsx`, `DashboardsPage.tsx`), sorted by priority then part number, with per-status filtering via query param.
- Priority flagging (0/1/2) on parts to surface urgent items within a status column.
- Assembly deletion guarded against orphaning children — refuses delete if the part has existing children (`backend/src/index.ts:1155-1164`).
- Material tracking fields per part: `source_material`, `have_material` boolean, `cut_length`, `quantity` — for stock/raw-material readiness at a glance.
- Drawing-created boolean flag per part (tracks whether a 2D drawing has been produced, separate from CAD status).
- Multi-project support: each project (season) has its own prefix and part tree, with a projects list/detail/CRUD UI (`ProjectsPage.tsx`, `ProjectDetailPage.tsx`, `ProjectFormPage.tsx`).
- Per-project `hide_dashboards` flag and a global `hide_unused_fields` setting to declutter the UI for simpler teams (`002_add_settings.sql`; `backend/src/index.ts:1624-1677`).

### Parts ordering / POs (area 5)
- Vendor-centric "order" grouping: order items auto-attach to an existing **open** order for the same vendor, or spin up a new open order, on item creation (`POST /projects/:projectId/order-items`, `backend/src/index.ts:1403-1463`) — mirrors a shopping-cart-per-vendor pattern rather than requiring manual PO creation first.
- "Unclassified" order items (no vendor/order yet assigned) listed separately so they can be triaged (`GET /projects/:projectId/order-items/unclassified`, `backend/src/index.ts:1384-1401`).
- Order lifecycle status: `open` → `ordered` → `received`, editable via `PUT /orders/:id` along with order date, tax/shipping cost, notes, and a `reimbursed` boolean for expense tracking (`backend/src/index.ts:1311-1343`).
- Changing an order item's vendor re-buckets it into that vendor's open order (or creates one), same find-or-create logic as creation (`PUT /order-items/:id`, `backend/src/index.ts:1465-1538`).
- Order deletion blocked while it still has line items (`backend/src/index.ts:1355-1364`), same guard pattern as assemblies-with-children.
- Cost accounting/statistics endpoint (`GET /projects/:projectId/orders/stats`, `backend/src/index.ts:1565-1618`): aggregates all non-open orders by vendor (order list + total cost = Σ item qty×unit_cost + tax + shipping) and separately by purchaser (`paid_for_by`), splitting each purchaser's spend into `reimbursed` vs `outstanding` totals — i.e., a built-in "who's owed money" reimbursement report. UI: `frontend/src/pages/OrderStatsPage.tsx`.
- All-orders view with filtering by vendor or purchaser (`GET /projects/:projectId/orders/all`, `backend/src/index.ts:1264-1292`; UI `AllOrdersPage.tsx`).
- Currency input sanitization/clamping helper (`parsePositiveCurrency`, `backend/src/index.ts:86-91`) strips `$`/commas, rejects negatives, caps at $1,000,000, rounds to cents — applied to every cost field on write.
- Order-items list per order embedded via Supabase relational select (`orders(*, order_items(*))`) rather than separate joins in app code.

## Integrations
- **Resend** (email API) for transactional email: new-registration admin alert and account-approval notification (`sendEmail`, `backend/src/index.ts:244-282`; HTML templates `buildRegistrationEmailHtml`/`buildApprovalEmailHtml`). Optional — silently no-ops if `RESEND_API_KEY` isn't configured.
- **Supabase** used purely as managed Postgres + client library; no Supabase Auth, no RLS policies (service-role key used server-side only, per `getSupabase`, `backend/src/index.ts:225-229`).
- **Cloudflare Workers** rate-limiting binding for login throttling (native platform feature, not a third-party integration).
- No CAD (Onshape/Fusion), Slack/Discord, or FRC-event-API integrations found.

## Notable Implementation Details
- Entire API is one 1,697-line `backend/src/index.ts` file — no route-file splitting, no ORM (raw Supabase query builder calls throughout). Simple but would get unwieldy at much larger scope; fine for a single-team tool.
- Auth token is a custom HMAC scheme, not JWT — hand-rolled but reasonable (`crypto.subtle` HMAC-SHA256, colon-delimited payload, base64-wrapped). Notably not a standard JWT library, so any reuse of this pattern should double check token expiry/replay handling before treating it as a template for other projects.
- `name.replace(/"/g, '&quot;')` HTML-escaping of only the double-quote character on part/user names (`backend/src/index.ts:1051`, `1084`) is a narrow, ad hoc XSS mitigation — not a substitute for proper output encoding; worth doing better in a reimplementation (e.g., let the frontend framework's default escaping handle it, or use a real sanitizer).
- Part-numbering logic is a straight port of the original Python Cheesy Parts' numbering rules (documented explicitly in the README), useful as a concrete, already-validated spec if recreating that scheme.
- Quantity/cut-length are free-text strings on `parts`, not numeric — flexible for odd units ("2 x 36in") but not aggregable without parsing.
- Order-item `part_number` is a free-text field distinct from the internal `parts.part_number` — it's meant for the vendor's/McMaster's SKU, not a link to an internal part record; there's no FK between order_items and parts, so ordering isn't tied back to the specific part it's for beyond a description string. A reimplementation wanting traceability (which order item fulfilled which part) would need to add that relation.
- Default admin user seed in the initial migration ships a `'placeholder_hash_change_me'` password hash that cannot actually authenticate (comment says to use the registration endpoint instead) — a copy-paste footgun if taken literally as a working seed.

## Verdict
Substantive and squarely in scope — real, working parts-ordering (vendor/PO/cost/reimbursement) and manufacturing-status-tracking features with concrete file-level logic, not a stub. Worth stealing: the vendor-open-order auto-bucketing pattern for order items, the reimbursed/outstanding-by-purchaser stats rollup, and the assembly-number-increments-by-100 / part-numbers-off-parent numbering scheme.
