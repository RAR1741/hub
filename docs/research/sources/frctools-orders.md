# frctools-orders — Source Survey

**Repo:** https://github.com/frctools/order-list ("FRCTools Orders", orders.frctools.com)
**Surveyed at commit:** `68045a4a41b9b0a63464173e1960b5a6a90bbeb1`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/frctools/order-list/blob/68045a4a41b9b0a63464173e1960b5a6a90bbeb1/<path>`

## Purpose

FRCTools Orders is a hosted purchasing/order-lifecycle web app for FRC teams — a lighter, purchasing-only counterpart to a full part-tracker like Cheesy Parts. Team members submit purchase requests (often by pasting a product URL, which auto-fills title/vendor/price), organizers review and advance them through a three-stage pipeline (To order → Ordered → Arrived), and everyone can search a shared, multi-vendor product catalog scraped from known team suppliers. It is one app in a small "FRCTools" suite (`frctools.com` domain, sibling to `orders.frctools.com`); this repo also vendors its own product-scraping/search microservice (`vendord/`).

## Stack

- **Framework:** Nuxt 4 (Vue 3), server routes under Nitro (`server/api/*`), deployed as a Cloudflare Worker (`wrangler.jsonc`-style config implied by `nitro-cloudflare-dev`, `@cloudflare/workers-types`, `docker-compose.yml` for local Postgres). `nuxt.config.ts`.
- **UI:** `@nuxt/ui` v4 (Nuxt UI Pro-style components: `UTable`, `USlideover`, `UPageHero`, etc.), Tailwind-based, `@nuxt/content` + `@nuxtjs/mdc` for the docs section.
- **Auth:** `better-auth` with the `organization` plugin — multi-tenant orgs, members, invitations, roles — backed by Drizzle (`server/utils/auth.ts`, `server/utils/auth-schema.ts`).
- **Database:** PostgreSQL via `drizzle-orm`/`drizzle-kit` (`pg` driver), migrations in `drizzle/*.sql` (13 migrations at this commit), app schema in `server/utils/schema.ts`.
- **Search:** MeiliSearch (hybrid/semantic search) for the cross-vendor product catalog (`server/api/vendors/search.get.ts`, `server/api/vendors/facets.get.ts`); a separate `vendord` Nitro service populates it.
- **Email:** Resend (`resend` npm package) + `@vue-email/components`/`@vue-email/render` for HTML email templates (invites, order-created, order-status-changed) — `server/utils/InviteEmail.vue`, `server/utils/OrderCreatedEmail.vue`, `server/utils/OrderStatusChangedEmail.vue`, `server/utils/email-service.ts`.
- **Other libs:** `zod` (all input validation), `@tanstack/vue-query`, `papaparse`/`scule` (CSV import parsing), `@ctrl/tinycolor` (tag text-color contrast), `@vueuse/router`/`@vueuse/core`, `@sentry/nuxt` (error monitoring), `@nuxtjs/plausible` (analytics).
- **License:** MIT, Copyright (c) 2025 Graham Howard — `LICENSE`. (Named individual, not an org — flag for reuse/attribution when recreating features.)
- **Companion service — `vendord/`:** a separate Nitro app in the same repo (own `package.json`) that scrapes vendor storefronts (Shopify `/products.json`, BigCommerce storefront GraphQL) into a shared Postgres `product_cache` table and syncs it into MeiliSearch (`vendord/server/tasks/scrape.ts`, `vendord/server/tasks/meilisearch/sync.ts`, `vendord/server/utils/bigcommerce.ts`). The main app's `server/api/vendors/index.get.ts` proxies live single-product lookups to this service (Cloudflare service binding in prod, `localhost:3001`/`3434` in dev).

## Auth & Roles

- **Sign-up/login:** `better-auth` email+password (`emailAndPassword: { enabled: true }` in `server/utils/auth.ts`); all auth traffic routes through the catch-all `server/api/auth/[...all].ts`. Pages: `app/pages/auth/login.vue`, `app/pages/auth/signup.vue`.
- **Multi-organization model:** users belong to one or more organizations (better-auth's `organization` plugin tables: `organization`, `member`, `invitation` in `server/utils/auth-schema.ts`). The active org is tracked per-session (`session.activeOrganizationId`) and switched client-side via `useOrgs().selectTeam` (`app/composables/organizations.ts`) and `OrganizationMenu.vue`.
- **Roles:** `owner`, `admin`, `member` (better-auth's default organization roles; UI seeds these three but role strings are otherwise free-form — `availableRoles` in `app/pages/organization.vue` unions whatever roles are already in use). Enforcement is inconsistent and shallow:
  - Server-side: only tag creation checks role (`server/api/tags/index.post.ts` — 403 unless `membership.role` is `admin` or `owner`). Order create/update/delete/bulk (`server/api/orders/*.ts`) and tag delete/list have **no role check** — any authenticated org member can do anything to orders, and any member can delete tags via `DELETE /api/tags/:id` (only checked client-side: the "Delete" button on the Tags tab is hidden unless `canManageMembers`, `app/pages/organization.vue`).
  - Client-side only: member-role editing, member removal, and the "Delete organization" danger-zone button are gated by `canManageMembers`/`canDeleteOrganization` computed from the current user's role, but the underlying better-auth organization endpoints (`updateMemberRole`, `removeMember`, `organization.delete`) presumably enforce their own server-side permission checks (not visible in this repo — they live in the `better-auth` package).
  - `TODO.md` explicitly lists "Block member role from advancing orders" as an open, unimplemented item, confirming order-status changes are currently open to all roles.
- **Invitations:** email invites via better-auth's `organization.inviteMember`, delivered through the `sendInvitationEmail` hook in `server/utils/auth.ts` (Resend + `InviteEmail.vue`, link `/accept-invitation/:id`). Accept flow: `app/pages/accept-invitation/[...key].vue`. Pending/expired invitations are listed and can be resent or canceled from `app/pages/organization.vue`.
- **Session/org guard:** every organization-scoped API route calls `requireOrganizationContext(event)` (`server/utils/session.ts`), which loads the better-auth session, requires a non-null `session.activeOrganizationId` (400 "No organization selected" otherwise), then calls `getFullOrganization` to resolve the caller's `membership` row — 401 if no session.

## Data Model

(`server/utils/schema.ts`, `server/utils/auth-schema.ts`, `drizzle/*.sql`)

- **`user` / `session` / `account` / `verification`** — better-auth's standard identity tables (email/password credential in `account.password`).
- **`organization` / `member` / `invitation`** — better-auth's organization-plugin tables. `member.role` is free text (not an enum); `session.activeOrganizationId` tracks the active org per session.
- **`orders`** — the core purchasing record: `partName`, `description`, `status` (pg enum `order_status`: `to_order` | `ordered` | `arrived`, default `to_order`), `quantity`, `unitPriceCents`, `variantId`/`variantTitle` (vendor product variant), `vendorId` (FK-like text to `vendors.id`, nullable) / `vendorName` (free-text fallback when no catalog vendor matches), `externalUrl`, `orderedAt`/`arrivedAt` timestamps (set when status transitions), `requestedBy` (FK to `user`, `onDelete: restrict` — an order always keeps its requester), `organizationId` (FK, cascade delete), `createdAt`/`updatedAt`.
- **`tags`** — per-organization (`organizationId` FK cascade), `name`, `color` (hex, default indigo `#6366f1`).
- **`orderTags`** — many-to-many join table, composite PK `(orderId, tagId)`, both FKs cascade on delete.
- **`vendors`** — the scraped-catalog side: `id`, `name`, `type` (`'shopify' | 'bigcommerce' | 'amazon'`), `config` (opaque text), `hostname`.
- **`productCache`** — one row per scraped product (`id` = `hostname:handle`), `productJson` (raw/unified product blob), `vendorId`, `updatedAt` — source data mirrored into MeiliSearch for the `/search` page.
- **`notificationPreferences`** — per-user-per-organization: `orderCreated`, `orderStatusChanged`, `orderDeleted` (booleans), `dailyDigest` + `digestTime`.
- **`notificationLog`** — audit trail of sent notification emails: `type`, `subject`, `recipientEmail`, `status`, indexed by user/org/type/createdAt.

Note: `orders.vendorId`/`orderTags.tagId` etc. are declared with `.references()` in Drizzle but the relation to `vendors` is not modeled as a `relations()` block for `orders` (only `orderTags` is) — vendor joins are done ad hoc with `leftJoin` in each query rather than through Drizzle's relational query API.

## Features

- **Landing/marketing page** — hero, feature grid, promo video, CTA; copy pitches "smart product inputting," request management, order tracking, receiving workflow, multi-org support, price tracking. `app/pages/index.vue`.
- **Sign up / log in** — email+password via better-auth. `app/pages/auth/signup.vue`, `app/pages/auth/login.vue`.
- **Organization creation & switching** — users can belong to multiple organizations; `OrganizationMenu.vue` in the app header switches the active org (cookie-backed `activeOrganizationId`), auto-selecting the first org on first load. `app/composables/organizations.ts`.
- **Order board (Kanban)** — three drag-and-drop columns (To order / Ordered / Arrived); each card shows part name, requester, quantity, price, variant, vendor, ordered/arrived/updated timestamps, and tags; drag-and-drop or an "Advance" button moves status forward one step, setting `orderedAt`/`arrivedAt` server-side. `app/pages/app.vue` (`onDrop`, `advanceStatus`), `server/api/orders/[id].patch.ts`.
- **Order table view** — sortable/filterable table (start/end date, vendor, status, tag filters) with running total-spend and result-count summary; per-row Advance/Edit/Remove actions. `app/pages/app.vue`.
- **CSV export** — client-side export of the currently filtered table rows (part, description, status, qty, unit price, vendor, requester, dates, external URL) as a downloaded `.csv`. `app/pages/app.vue` (`exportOrdersCsv`).
- **Create/edit order via slideover, with smart product lookup** — pasting a vendor product URL into the "External link" field triggers `GET /api/vendors?url=...`, which resolves/creates a `vendors` row and (for Shopify) returns the live product's title, variants, and prices; the form auto-fills part name and offers a variant picker. `app/components/OrderEditorSlideover.vue`, `server/api/vendors/index.get.ts`, `vendord/server/routes/scrape.ts` (single-product scrape endpoint reached via the proxy).
- **Manual order entry** — part name, quantity, unit price, vendor name/id (free text if not a known catalog vendor), variant id/title, notes, tags — for parts not found in the scraped catalog. `app/components/OrderEditorSlideover.vue`, `server/utils/order-service.ts` (`createOrderSchema`).
- **Tags** — per-organization colored labels attached to orders (create/delete in Organization Settings → Tags tab, admin/owner-gated on the server for creation; select on the order editor and filter by tag in the table view). `server/api/tags/index.{get,post}.ts`, `server/api/tags/[id].{patch,delete}.ts`, `app/components/TagEditorSlideover.vue`, `app/pages/organization.vue`.
- **Order removal** — delete a single order (`DELETE /api/orders/:id`); confirmed via toast, no confirmation dialog. `server/api/orders/[id].delete.ts`.
- **Cross-vendor product search** — a public `/search` page hits MeiliSearch (hybrid semantic + keyword) across every scraped vendor's catalog, with vendor-facet filtering, relevance/price sorting, grid/list view, and an "Add to order" button that deep-links into the order-creation flow (`/app?add=<url>`). `app/pages/search.vue`, `server/api/vendors/search.get.ts`, `server/api/vendors/facets.get.ts`.
- **BOM/CSV bulk import** — upload a CSV (Part Number / Quantity / Description columns, auto-detected via `scule` header normalization), which auto-searches each row against the product catalog, lets the user confirm/adjust the matched product and variant per row, then bulk-creates orders via `POST /api/orders/bulk`. Explicitly aimed at Onshape BOM exports (in-app doc: `app/components/content/DocsOnshapeBOMTool.vue`, linked from the import modal). `app/components/dashboard/Import.vue`, `server/api/orders/bulk.post.ts`, `server/utils/order-service.ts` (`createOrdersBulk`).
- **Organization member management** — list members with role, invite by email with a role picker, change a member's role, remove a member (self-removal blocked); pending-invitation list with resend/cancel. Role-management UI is gated client-side to admins/owners. `app/pages/organization.vue`.
- **Organization deletion ("Danger Zone")** — owner-only (client-gated) permanent delete of the org and all its orders/tags/members, with a native `confirm()` prompt. `app/pages/organization.vue`.
- **Email notifications** — on order creation, every other org member gets an email (`OrderCreatedEmail.vue`); on status change, every member gets an email (`OrderStatusChangedEmail.vue`); on invite, the invitee gets an email (`InviteEmail.vue`); sends are recorded in `notificationLog`. `server/utils/notification-helpers.ts`, `server/utils/email-service.ts`.
- **Per-user notification preferences** — toggle order-created/status-changed/deleted emails and an opt-in daily digest with a configurable send time. `server/api/notifications/preferences.{get,patch}.ts`, `app/components/NotificationPreferences.vue`, `app/composables/notifications.ts`.
- **Notification log / activity feed** — a per-user list of recently sent notifications (subject, recipient, status). `server/api/notifications/log.get.ts`, `app/composables/notifications.ts`.
- **Docs site** — `@nuxt/content`-driven documentation under `/docs`, including a dedicated Onshape BOM import walkthrough. `app/pages/docs/*.vue`, `content/`.

Not present (per `TODO.md`'s open items): CSV export is done but CSV *import re-export* isn't listed; Amazon vendor scraping is a stubbed no-op (`vendord`'s scrape task has an empty `else if (vendor.type === 'amazon')` branch); no per-organization order-approval workflow (any member can advance/delete any order); no audit log for order edits (only notification sends are logged, not the underlying change).

## Integrations

- **Resend (transactional email)** — invite, order-created, order-status-changed emails; API key via `RESEND_KEY` env var. `server/utils/auth.ts`, `server/utils/email-service.ts`.
- **MeiliSearch** — hosted/self-hosted search index (`MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX` env vars) powering `/search`; populated by the `vendord` service's sync task. `server/api/vendors/search.get.ts`, `vendord/server/tasks/meilisearch/sync.ts`.
- **Shopify storefronts** — public `/products.json` REST endpoint scraped/paginated per known Shopify vendor. `vendord/server/tasks/scrape.ts`.
- **BigCommerce storefronts** — storefront GraphQL API via a scraped storefront token/cookies flow. `vendord/server/utils/bigcommerce.ts`.
- **Amazon** — declared as a vendor `type` in the schema but scraping is unimplemented (no-op).
- **Cloudflare Workers/Wrangler** — production deployment target; `vendord` is reached as a bound Worker service (`event.context.cloudflare.env.VPC_SERVICE`) in prod, plain `fetch` to localhost in dev. `server/api/vendors/index.get.ts`, `wrangler.jsonc`/`nitro-cloudflare-dev` config.
- **Sentry** — error monitoring (`@sentry/nuxt`, `sentry.client.config.ts`, `server/plugins/sentry.ts`).
- **Plausible Analytics** — privacy-focused web analytics (`@nuxtjs/plausible`).
- **Onshape (workflow integration, not API)** — no direct API call; the BOM-import feature is designed around Onshape's CSV BOM export format, documented in-app.

## Notable Implementation Details

- **Two-tier vendor identity.** An order's vendor is either a resolved `vendors.id` (a known, scraped storefront) or a free-text `vendorName` fallback — every read path (`fetchOrderWithDetails`, list/bulk queries) does `coalesce(vendors.name, orders.vendorName)` so unrecognized vendors still display sensibly. `server/utils/order-service.ts`, `server/api/orders/index.get.ts`.
- **Role enforcement gap.** Only tag creation checks `membership.role`; order mutation, tag deletion, and status advancement are open to any authenticated org member despite the UI implying admin/owner-gated controls elsewhere — confirmed both by reading every `server/api/orders/*` handler and by `TODO.md`'s open "Block member role from advancing orders" item.
- **Status transitions carry timestamp side-effects.** `PATCH /api/orders/:id` sets `orderedAt`/`arrivedAt` based on the *new* status, preserving any existing timestamp rather than overwriting it (`updates.orderedAt = existingOrder.orderedAt ?? new Date()`), and clears both when moved back to `to_order`. `server/api/orders/[id].patch.ts`.
- **Bulk vendor resolution batching.** `createOrdersBulk` resolves all unique vendor inputs in a single `IN (...)` query before inserting, rather than one lookup per row, to keep CSV-import bulk-creates from N+1 querying. `server/utils/order-service.ts`.
- **MeiliSearch filter built by string interpolation.** `server/api/vendors/search.get.ts` constructs the vendor filter as `vendorName = '...'` by escaping only single quotes, then hands the resulting string to Meilisearch's filter expression parser — a narrower injection surface than SQL but still string-built rather than using a parameterized filter API.
- **Product-lookup proxy environment branching.** `server/api/vendors/index.get.ts` picks its downstream URL (`localhost:3434` prod-emulated vs `localhost:3001` dev) and its transport (Cloudflare service binding `Fetcher` vs plain `fetch`) based on `import.meta.dev`, coupling the main app tightly to `vendord` running as a sibling process/service.
- **CSV import matching heuristic.** The BOM importer auto-selects a search hit only when a returned SKU (or one of `skus[]`) case-insensitively equals the CSV row's part number; otherwise the row is left for manual selection — a deliberately conservative heuristic to avoid mis-matching parts. `app/components/dashboard/Import.vue`.
- **No test suite visible at this commit** (no `test`/`spec` directories, no test script in `package.json` beyond lint/typecheck) and a single-author `LICENSE` (individual copyright, not an org) — worth flagging for any team relying on it as a going concern.
- **Renovate bot configured** (`renovate.json`) for automated dependency updates — signals ongoing maintenance intent even without a visible CI test suite.
