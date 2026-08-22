# Inventory System (Backend + Frontend) — Source Survey

**Repo:** eduardohartz/inventorysystembackend — https://github.com/eduardohartz/inventorysystembackend
**Companion repo:** eduardohartz/inventorysystemfrontend — https://github.com/eduardohartz/inventorysystemfrontend
**Surveyed-at (backend):** ef1b47e74ca76688544b61efed94f842057f2b8f
**Surveyed-at (frontend):** c4d1fbe686fcfba68cb4854b513c917963246a06
**Permalink form:** https://github.com/eduardohartz/inventorysystembackend/blob/ef1b47e74ca76688544b61efed94f842057f2b8f/<path>
(frontend: https://github.com/eduardohartz/inventorysystemfrontend/blob/c4d1fbe686fcfba68cb4854b513c917963246a06/<path>)
**Stack:** Backend — TypeScript, Express, Prisma ORM, MySQL, bcrypt, a hand-rolled filesystem-based router. Frontend — Next.js (App Router), TypeScript, shadcn/ui (Radix), Tailwind, a touch-first kiosk UI (on-screen keyboard, touch inputs) and barcode-scanner input capture.
**License:** none (no LICENSE file in either repo) — all rights reserved. Ideas only, no code reuse.
**Last activity:** backend 2025-06-13; frontend 2026-02-02 (frontend is actively maintained; backend appears feature-frozen)
**FRC team:** Team 1318 (per both repos' GitHub descriptions: "originally made for FRC Team 1318")
**Areas:** (5) parts ordering/POs — partial (physical stock/asset tracking, not purchase-order workflow) — and general parts/asset inventory management, which is adjacent to (6) part design/manufacturing tracking in spirit (tracking physical stock of manufactured/purchased parts, tools, and materials) but does not touch CAD or build-log data.

## Purpose
A self-hosted, kiosk-style physical inventory system for an FRC team's shop: catalog categories, item types (SKUs), individual physical items/units, and storage locations in a hierarchy, each item barcoded for quick lookup, check-in/out status, and condition tracking. Built for a shared shop tablet/kiosk (on-screen keyboard, auto-redirect-to-lookup on inactivity, big touch targets) rather than a desktop admin panel.

## Auth & Roles
Single shared "settings password" model, not a user/role system — there is no login, no user table, no JWT/session cookies anywhere in either repo.
- `Settings` table stores no password field in the current schema (`prisma/schema.prisma`) even though `constraints_builder.ts` imports `bcrypt` and defines `addPasswordConstraint()` — that constraint's implementation is a stub: it calls `runnable()` but never uses or checks its return value, then unconditionally returns `true` (`src/utils/builders/constraints_builder.ts`). So the "password to protect settings" feature exists in the frontend (`components/password-dialog.tsx`, prompts to create/confirm a password) but the backend enforcement is effectively a no-op — settings reads/writes succeed regardless of password.
- No authorization/roles for items, categories, locations, etc. — any client with network access to the API has full CRUD.
- CORS in `src/index.ts` allows only `http://localhost:3000` and lists `methods`/`allowedHeaders`/`credentials` inside a plain object literal passed to the `cors` package — `cors`'s actual options keys are `origin`/`methods`/`allowedHeaders`/`credentials`, so `allowedOrigins` (misspelled key) is silently ignored and the library falls back to reflecting/allowing all origins by default. Worth noting as a "looks locked down but isn't" gotcha for a re-implementer.

## Data Model
Prisma/MySQL schema (`prisma/schema.prisma`):
- `Categories` — self-referential tree (`parentId` → `Categories`), has many `ItemTypes` and `Items`.
- `Locations` — self-referential tree (`parentId` → `Locations`), can be the `defaultLocation` for an `ItemType`, and holds many `Items`.
- `ItemTypes` — a "SKU"/catalog entry: name, manufacturer, model, belongs to a `Category`, optional `defaultLocation`, `isLocation` flag (an item type can itself represent a storage location, e.g. a labeled bin), has many `Items`.
- `Items` — the physical/barcoded unit: unique `barcode`, optional link to `ItemType` (or standalone with its own name/category), `status` enum (`Available | CheckedOut | Maintenance | Reserved`), `condition` enum (`Excellent | Good | Fair | Poor | Broken`), `locationId`, `lastCheckedOut`/`lastCheckedIn` timestamps, `isLocation` flag, and a `history` relation.
- `ItemHistory` — audit log per item: `date`, free-text `action`, optional `notes`.
- `Settings` — single-row org config: org name/contact info, default location, feature toggles (barcode scanning, virtual keyboard, item-as-location, auto-redirect), `inactivityTimeoutMinutes`, `barcodePrefix`.
- Foreign keys are `onDelete: Cascade` throughout, and indexes exist on all FK columns plus `barcode` and `status`.

## Features
**Parts/asset inventory (area 5/6-adjacent — physical stock tracking):**
- Hierarchical categories and locations (parent/child trees) for organizing a shop's storage — `prisma/schema.prisma`, CRUD at `src/routes/api/categories/*`, `src/routes/api/locations/*`.
- Item-type catalog (SKU-level: manufacturer, model, description, default location) separate from individual physical units — `src/routes/api/itemTypes/*`.
- Individual item records with unique barcode, status, condition, notes, and "item can itself be a location" (nested storage, e.g. a bin with a barcode that contains other items) — `src/routes/api/items/get_.ts`, `src/routes/api/items/post_.ts`, `prisma/schema.prisma` (`Items.isLocation`).
- Barcode lookup endpoint resolving a scanned barcode straight to an item ID — `src/routes/api/lookup/get_.ts`; frontend barcode-capture component that hijacks keyboard focus so a USB/Bluetooth barcode-scanner "types" into a hidden input from anywhere in the kiosk UI — `components/barcode-scanner.tsx`.
- Global cross-entity search (categories, item types, items, locations in one query, capped 10 results each) — `src/routes/api/search/get_.ts`, `components/global-search.tsx`.
- Item history/audit trail model (`ItemHistory`) for logging actions against an item over time — `prisma/schema.prisma`; the actual check-out/check-in write path is an unimplemented stub (`// TODO`) at `src/routes/api/items/_id/post_.ts`, so the history feature is schema-only in this snapshot.
- Org-wide settings: barcode prefix, default location, feature flags, kiosk inactivity timeout — `src/routes/api/settings/get_.ts`, `src/routes/api/settings/post_.ts`, `app/settings/page.tsx`.
- Kiosk UX: on-screen touch keyboard for shared tablets without a physical keyboard (`components/on-screen-keyboard.tsx`, `contexts/keyboard-context.tsx`), touch-sized inputs (`components/touch-input.tsx`, `components/touch-textarea.tsx`), and auto-redirect back to the lookup/home screen after N minutes of inactivity (`hooks/use-auto-redirect.tsx`) — all aimed at a walk-up shop terminal rather than a per-user desktop app.
- Add/browse/edit flows are split into dedicated routes per entity type (category, item-type, individual item, location) under `app/add/*`, `app/browse/*`, `app/edit/*`, each with its own loading skeleton.

## Integrations
None. No OAuth/Slack/Discord/Onshape/TBA/email/SMS integration in either repo — this is a standalone, self-hosted, LAN-only tool (CORS restricted to `localhost:3000`).

## Notable Implementation Details
- **Convention-based file router, not Express Router mounting**: `src/utils/router.ts` recursively walks `src/routes/`, importing each `get_.ts`/`post_.ts`/`put_.ts`/`delete_.ts` file and registering it on the shared `app` by string-replacing the filename (`_id` folder → `:id` param) into a path. Cute for small APIs, but it does synchronous `fs.readdirSync` + dynamic `import()` at boot inside a `forEach`, and resolves the returned promise only when the *last array index* finishes — async imports can finish out of order, which is a latent (if likely harmless here) race in the boot-time loader (`src/utils/router.ts`).
- **`ConstraintsBuilder`** (`src/utils/builders/constraints_builder.ts`) is a small fluent validator (`addRequiredField(s)`, `addSQLField(s)` — a naive blocklist of `"`, `'`, `\` rather than using Prisma's parameterization, which already protects against SQL injection, making this constraint mostly redundant/security-theater — `addFieldLength`, `addPasswordConstraint`) that colects errors before running the route body. Straightforward pattern worth borrowing structurally, but see the auth section above: `addPasswordConstraint`'s callback result is discarded, so it never actually gates anything today.
- Prisma schema is clean and normalized with sensible cascade deletes and indexes — a good reference schema shape for a from-scratch parts/asset inventory re-implementation (category tree, location tree, item-type vs. item split, status/condition enums, audit-log table).
- Frontend is genuinely kiosk-hardened (inactivity auto-redirect, on-screen keyboard, barcode-scanner-as-keyboard-input capture, touch-sized controls) — useful reference UX for any shop-floor terminal, distinct from a typical admin CRUD frontend.
- No tests, no CI config, no auth system, no rate limiting; single-row `Settings` table is looked up with a hardcoded `id: 3` in the update route rather than `findFirst()`, which will break on any fresh seed where the settings row isn't literally id 3 (`src/routes/api/settings/post_.ts`).

## Verdict
Substantive and directly relevant to area 5/6: a clean, purpose-built physical-parts/asset inventory schema and kiosk UX for an FRC shop, worth stealing the **data model** (category/location trees, item-type vs. item split, status+condition enums, audit-log table) and the **kiosk UX patterns** (barcode-as-keyboard capture, inactivity auto-redirect, on-screen keyboard) — but the backend's auth is non-functional (a stubbed password check) and check-in/out history-writing is an unimplemented TODO, so treat it as a schema/UX reference, not a security or workflow reference.
