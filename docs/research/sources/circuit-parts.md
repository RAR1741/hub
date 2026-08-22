# Circuit Parts — Source Survey

**Repo:** 1Ghasthunter1/circuit-parts — https://github.com/1Ghasthunter1/circuit-parts
**Surveyed-at:** 9560d4036dbef9e71e3da4d20db2266dc0ab0005
**Permalink form:** https://github.com/1Ghasthunter1/circuit-parts/blob/9560d4036dbef9e71e3da4d20db2266dc0ab0005/<path>
**Stack:** TypeScript monorepo — Express + Mongoose (MongoDB) server (`packages/server`), React + Vite + Tailwind client (`packages/client`); JWT auth (jsonwebtoken + bcrypt), express-validator for input validation; deployed via Docker/Heroku, client separately on Vercel.
**License:** none found (no LICENSE file, no license field in repo metadata) — ideas only, all rights reserved.
**Last activity:** 2023-06-16 (pushed_at); most recent commit surveyed is from 2022-11-20.
**FRC team:** unknown (no team number in README/package metadata; author handle "1Ghasthunter1")
**Areas:** (5) parts ordering/POs, (6) part design/manufacturing tracking

## Purpose
A from-scratch reimplementation of Team 254's Cheesy Parts (explicitly stated in the README: "next-generation parts management server for FRC teams based on Team 254's Cheesy Parts system"), targeting part/assembly hierarchy management, part numbering, manufacturing status tracking, and order/finance tracking for FRC teams, with a modern React/TypeScript stack instead of Cheesy Parts' Sinatra/Ruby stack.

## Auth & Roles
- JWT-based auth: `packages/server/routes/loginRouter.ts` — login issues a short-lived access token (`jwt.sign`, `config.ACCESS_TOKEN_EXPIRY`) plus a server-tracked UUID refresh token appended to `user.refreshTokens`; `/signout` removes a specific refresh token from that array. `clearOldTokens` (in `packages/server/services/userService.ts`) prunes stale refresh tokens on each login.
- Passwords hashed with bcrypt (`packages/server/models/user.ts`, `usersRouter.ts`); `hash` field is stripped from JSON output via a Mongoose `toJSON` transform.
- Three roles: `admin`, `user`, `owner` (`packages/server/types/universalTypes.ts`, `userRoles`).
- Middleware (`packages/server/utils/middleware/middleware.ts`): `tokenExtractor` pulls a Bearer token off the `Authorization` header; `userExtractor` verifies the JWT and attaches the Mongoose user doc to `req.user`; `adminRequired` gates routes to `admin`/`owner` roles (403 otherwise).
- Self-service vs admin permission split enforced in `usersRouter.ts` `PUT /:id`: non-admins can edit their own name/email but a role change or a password change on another account is rejected (403) unless the requester is `admin`/`owner`.
- Centralized error handler (`middleware.ts` `errorHandler`) maps Mongoose `ValidationError`/`CastError`, JWT errors, and Mongo duplicate-key (11000) errors to appropriate HTTP status codes with a generic message — a reusable pattern for a re-implementer.

## Data Model
Mongoose schemas, all under `packages/server/models/`:
- **User** (`user.ts`) — firstName/lastName/username/email (unique, regex-validated), `role` enum, `refreshTokens[]` (token + creationDate), bcrypt `hash`.
- **Project** (`project.ts`) — name, `prefix` (used to build part numbers), creationDate, description, `children[]` (via shared `childrenSchema`).
- **Assembly** (`assembly.ts`) — name, `parent` (polymorphic ref via `parentSchema`), `children[]` (polymorphic ref via `childrenSchema`, can be assemblies or parts), `path[]` (materialized breadcrumb of parents), `project` ref, `partNumber`, `status`, `priority`, `notes`, `creationDate`.
- **Part** (`part.ts`) — name, `partNumber`, `parent`/`path` (same polymorphic pattern as assembly), `project` ref, `status` (9-state manufacturing pipeline), `priority`, `creationDate`, `notes`, `sourceMaterial`, `haveMaterial` (bool), `materialCutLength`, `quantityRequired`.
- **Order** (`models/order/order.ts`) — project ref, `orderNumber`, `status` (open/ordered/received), `vendor`, `tracking` (carrier + trackingNumber sub-object), `tax`, `shipping`, `purchaser`, `reimbursed` (bool), `orderDate`, `notes`.
- **OrderItem** (`models/order/orderItem.ts`) — order ref, `partNumber` (vendor SKU, not internal), `vendorUrl`, `quantity`, `description`, `unitCost`, `notes` — separate collection from Order, joined by `order` ref (see `ordersService.ts` `getPopulatedOrder`).
- Shared polymorphic sub-schemas: `schemas/parentSchema.ts` (parentType: assembly|project + ObjectId `refPath`) and `schemas/childrenSchema.ts` (childType: assembly|part + ObjectId `refPath`) — a generic Mongoose "discriminated ref" pattern letting a part/assembly's parent, and an assembly's children, point at either of two different collections.
- Status/priority/type enums centralized in `types/universalTypes.ts`: `assemblyStatuses` (5-state: design in progress → ready for assembly → assembly in progress → design review needed → done), `partStatuses` (9-state, including per-machine states: ready for cnc/laser/lathe/mill), `priorities` (low/normal/high/urgent), `orderStatuses` (open/ordered/received).

## Features
**Part design/manufacturing tracking (area 6):**
- Hierarchical project → assembly → part tree with polymorphic parent/child refs and a materialized `path` breadcrumb, so any part/assembly knows its full ancestor chain without recursive queries (`models/part.ts`, `models/assembly.ts`, `models/schemas/*`).
- Automatic, collision-checked part numbering scheme mirroring Cheesy Parts' `<project-prefix>-<A|P>-<assembly##><part##>` format: `packages/server/utils/partNumbers/generatePartNumber.ts` scans all existing assemblies/parts in a project, parses existing part numbers back into components, and increments the next sequential 2-digit assembly or part number. Assemblies get `A` + sequential 2-digit number + `00`; parts get `P` + their parent assembly's number + their own sequential 2-digit number.
- 9-stage part manufacturing status pipeline including machine-specific ready states (cnc/laser/lathe/mill) and a 5-stage assembly status pipeline (`types/universalTypes.ts`), each rendered client-side via colored status boxes (`components/parts/PartStatusBox.tsx`, `components/assemblies/AssemblyStatusBox.tsx`).
- Priority tagging (low/normal/high/urgent) on parts and assemblies (`components/components/PriorityBox.tsx`).
- Material tracking fields on parts: `sourceMaterial`, `haveMaterial` flag, `materialCutLength`, `quantityRequired` (`models/part.ts`).
- Project/assembly/part CRUD via modals: `CreateProjectModal.tsx`, `CreateAssemblyModal.tsx`/`EditAssemblyModal.tsx`, `CreatePartModal.tsx`/`EditPartModal.tsx`.
- Breadcrumb navigation component reflecting the materialized `path` (`components/navigation/Breadcrumbs.tsx`).
- Client-side dashboard/kanban-style views per project (`views/DashboardView.tsx`, `components/dashboard/ProjectsDashboard.tsx`, `components/parts/PartTable.tsx`).

**Parts ordering/POs (area 5):**
- Order model with vendor, order/tracking numbers, shipping/tax, purchaser, and a `reimbursed` boolean for tracking team-member reimbursement status (`models/order/order.ts`).
- Order line items as a separate collection (vendor part number/SKU, vendor URL, quantity, unit cost, description) joined to the parent order (`models/order/orderItem.ts`, `services/ordersService.ts`).
- Shipment tracking sub-object (carrier + tracking number) with a dedicated UI (`components/orders/TrackingModal.tsx`, `TrackingCard.tsx`, `TrackingNumber.tsx`).
- Order totals computation client-side (`components/orders/OrderTotals.tsx`) and order status progress indicator (open → ordered → received) (`components/orders/OrderStatusProgress.tsx`, `OrderStatusBox.tsx`).
- Order item entry/edit rows and per-item part-number lookup modal (`components/orders/NewItemRow.tsx`, `OrderItemPartNumberModal.tsx`, `OrderItemsTable.tsx`).
- Order list/detail views (`views/orders/OrdersView.tsx`, `views/orders/OrderView.tsx`) and delete-order confirmation modal (`components/modals/DeleteOrderModal.tsx`).

**Cross-cutting / platform:**
- Role-gated user management: list/create/update/delete users, self-service profile edit vs admin-only role/other-password changes, dedicated change-password endpoint with old-password verification (`routes/usersRouter.ts`, `views/UsersView.tsx`, `components/users/*`).
- JWT access + refresh token auth with server-side refresh-token list per user and stale-token pruning (`routes/loginRouter.ts`, `services/userService.ts`).
- Centralized Express error-handling middleware normalizing Mongoose/JWT/duplicate-key errors to HTTP responses (`utils/middleware/middleware.ts`).
- express-validator schema validation on user/part/assembly/order/project inputs (`validation/*.ts`, `utils/middleware/schemaValidation.ts`).

## Integrations
None. No Onshape/CAD-file integration, no Slack/Discord/email, no TBA. Despite the "keep CAD folders organized" tagline in the GitHub description, no CAD-file linkage was found in the source — it's a pure hierarchy/status/ordering tracker, not a file manager.

## Notable Implementation Details
- The polymorphic parent/child schema pattern (`parentSchema`/`childrenSchema` using Mongoose `refPath`) is a clean, reusable way to let a single field reference either of two different collections (assembly-or-project as parent; assembly-or-part as child) — worth reusing conceptually for any project/assembly/part tree.
- Part numbering is recomputed by re-parsing every existing part number's string representation on each new-number request (`generatePartNumber.ts`) rather than storing a running counter — correct but O(n) per creation and fragile to hand-edited part numbers; a real implementation should prefer a persisted counter or DB sequence.
- Repo ships committed `build/` output (compiled JS + source maps for both client and server) alongside source — noise to ignore when reading, not a pattern to copy.
- Client and server are two independently deployed apps in one repo (server on what looks like Heroku/Docker per the `Dockerfile` and `herokuBuild` commit message; client separately on Vercel per `homepage: circuit-parts.vercel.app`), not a single Next.js-style app.
- README explicitly lists "Integrate user authentication" as still on the roadmap even though auth code exists in the tree — suggests the repo was mid-development/abandoned (last push mid-2023, last real commit late 2022) and auth may not have been fully wired into all routes; verify each router's guard before treating any endpoint as protected by default.

## Verdict
Substantive and directly relevant — a real (if unfinished/abandoned) TypeScript reimplementation of Cheesy Parts covering parts ordering (area 5) and part/assembly manufacturing tracking (area 6). Worth stealing: the polymorphic parent/child Mongoose ref pattern for a project→assembly→part tree, the materialized `path` breadcrumb, the per-project sequential part-numbering scheme, and the 9-state per-machine part status pipeline. No license, so treat as ideas-only.
