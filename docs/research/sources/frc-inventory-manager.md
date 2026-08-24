# FRC Inventory Manager — Source Survey

**Repo:** kaushalkk/frc-inventory-manager — https://github.com/KaushalKK/frc-inventory-manager
**Surveyed-at:** d021314f0735a7c6b20ee5281b5540f81ce8cbd5
**Permalink form:** https://github.com/KaushalKK/frc-inventory-manager/blob/d021314f0735a7c6b20ee5281b5540f81ce8cbd5/<path>
**Stack:** Node.js/Express REST API + MongoDB (Mongoose), JWT auth (passport-jwt); AngularJS 1.x SPA frontend (ui-router, ui-bootstrap, toastr) styled with AdminLTE/Bootstrap; vendored CKEditor and DataTables plugins (unused in the surveyed code paths)
**License:** ambiguous — `package.json` declares `"license": "ISC"` but there is no LICENSE file in the repo; treat as ideas-only per ground rules (no license file = all-rights-reserved by default; the package.json claim is unverified without the actual grant)
**Last activity:** 2017-02-10 (single-push history, `pushed_at`)
**FRC team:** none — this is a regional/organizational tool for "FIRST Robotics Canada" ("canfrc" JWT issuer), tracking assets across multiple named locations (Durham, Ryerson, Victoria Park, Waterloo, Georgian, Windsor, Western, FIRST Canada Warehouse), not a single team's shop tool
**Areas:** (5) parts ordering/POs — actually asset/equipment checkout-checkin and case-packing tracking, not purchase orders; (6) part design/manufacturing tracking — tangential, only via generic asset/case records, no design workflow

## Purpose
Tracks physical inventory (kits, cases, totes, individual products) for a regional FIRST Robotics organization that ships equipment between multiple locations: what's packed in which case, where a case currently is (checked out to which location), and a login-gated dashboard/search to look any of that up by asset tag. It is a logistics/asset-tracking tool, not a supplier purchase-order system — "order" here means a checkout/checkin transaction, not a PO to a vendor.

## Auth & Roles
- JWT-based auth via `passport-jwt` (`index.js`, `routes/users/index.js`). Login (`POST /user/login`) checks a bcrypt-hashed password (`bcryptjs`) against the `Users` collection and signs a JWT (RS256-style key file at `keys/rsa`, issuer `"canfrc"`, 3-day expiry) — but note the create/login flow signs with the private key `keys/rsa` while `index.js`'s passport-jwt strategy verifies with a different file, `keys/rsakey.pem`; these are almost certainly meant to be the public/private halves of one RSA keypair (not committed), so the app cannot run out of the box without generating that keypair.
- Every asset/order/user route except `POST /user/login` is gated by `passport.authenticate("jwt", {session:false})`. No refresh-token flow, no logout invalidation (client just drops the cookie).
- No role model at all — a single `status` field on `Users` (`active`/`inactive`, unenforced) is the only hint of permission tiering; any authenticated user can create/edit any asset, create users, or check any item in/out. Flat single-tier auth.
- Frontend stores the JWT in a cookie via Angular's `$cookies` (`public/js/login-dir.js`, `public/js/service.js`) and manually attaches it as an `Authorization: JWT <token>` header on every API call.

## Data Model
Three flat Mongoose collections (`db/schema.js`, `db/models.js`), no relational joins — cross-references are done by string matching on `assetTag`/`caseNumber` at query time:
- **User** — `username` (unique), `email`, `status`, `password` (bcrypt hash), timestamps.
- **Asset** — `assetTag` (unique), `type` enum `product`/`case`/`tote`, `name`, `description`, `caseNumber` (unique, only meaningful for `type:case`), and an embedded `inCase` sub-doc (`status`, `case` = parent case number, `quantity`) used by non-case assets to record which case they're packed into and how many units.
- **Order** — really a checkout/checkin transaction log: `user` (username who acted), `status` enum `checkin`/`checkout`, `assetTag`, `location` (free-text destination), `productName` (denormalized copy of the asset name at transaction time), `checkInTime`, `checkOutTime`, timestamps. `routes/orders/index.js` upserts on `{assetTag, checkInTime: null}` so there's effectively one "open" order per asset at a time.

## Features
**Parts/equipment ordering & tracking (area 5, checkout/checkin framing not vendor POs):**
- Create any asset (case, tote/bin, or product) via a single "Create" form (`public/js/create-dir.js`, `templates/create.html` referenced) — sets type, tag, name, description, and either a case number (for cases) or a parent-case assignment + quantity (for items going into a case).
- Checkout/checkin transactions per asset tag, tagged with a destination location from a fixed location list (Durham, Ryerson, Victoria Park, Waterloo, Georgian, Windsor, Western, FIRST Canada Warehouse) — `public/js/orders-dir.js`, `routes/orders/index.js`. Denormalizes the product name onto the order at write time so history survives asset renames.
- Assign/reassign a loose product into a case with a quantity (`POST /asset/:assetTag/assign`, `routes/assets/index.js`) — sets `inCase.status/case/quantity` on the child asset.
- Asset detail lookup by tag returns the asset plus its associated order history and, if it's a case, every product currently packed inside it (`GET /asset/:assetTag`, `routes/assets/index.js` — two parallel queries joined with `q.all`/`spread`).
- Paginated list views for orders, cases/totes, and products separately, each with server-side keyset pagination (`updatedAt` cursor via `page=next|prev` + `offset`) and a count — `public/js/orders-dir.js`, `products-dir.js`, `cases-dir.js`; backing routes `GET /orders`, `GET /asset/cases`, `GET /asset/products`.
- Order search/filter by `status` or `location` (`orderSearchOptions` in `orders-dir.js`) — filtering by location implicitly forces `status: checkout` server-side, i.e. "what's currently out at location X".
- Dashboard (`public/js/dashboard-dir.js`) surfaces recent orders and an asset-tag quick-search that opens a modal with details.

**Auth/session:**
- Login screen + JWT cookie session, logout clears the cookie (`public/app.js` router config, `login-dir.js`).

## Integrations
None. No Onshape/TBA/Slack/Discord/email/SMS/Google integration of any kind. All vendored frontend libraries (CKEditor, DataTables, AdminLTE, Bootstrap, jQuery, FontAwesome under `public/plugins/`, `public/bootstrap/`, `public/dist/`) are static assets bundled via Bower, not live integrations — several (CKEditor, DataTables) don't even appear to be wired into any Angular directive in the surveyed code.

## Notable Implementation Details
- Extremely small real surface area for a "6.4MB, real-sized" repo — the 6.4MB is almost entirely vendored front-end libraries (CKEditor, DataTables extensions, Bootstrap/AdminLTE, jQuery) checked into `public/`. Actual hand-written code is ~10 server files and ~7 Angular directive files.
- Two different RSA key files referenced (`keys/rsakey.pem` for JWT verification in `index.js`, `keys/rsa` for JWT signing in `routes/users/index.js`) and neither is committed — a re-implementer copying this pattern should just use one shared secret/keypair path, and prefer HS256 with an env-var secret over managing RSA files at all for something this size.
- No pagination cursor validation — `offset` from the query string is passed directly into a Mongo `$lt`/`$gt` comparison on `updatedAt` with no type-checking; fine at hobby scale, not something to copy for anything exposed further than an internal tool.
- No input validation/schema enforcement beyond Mongoose's own required/unique/enum constraints — e.g. `caseNumber`, `itemInCase`, `itemCountInCase` are taken as raw strings from the create form and stored as-is.
- Single global CORS header (`Access-Control-Allow-Origin: *`) applied to every response in `index.js` — combined with JWT-in-header auth this is a workable but very permissive default; worth tightening if recreating.
- Order upsert pattern (`findOneAndUpdate({assetTag, checkInTime: null}, order, {upsert:true})`) is a simple, reusable idea for "at most one open transaction per item" without a separate state machine — worth reusing conceptually for a check-in/out feature.
- Locations are a hardcoded array in the frontend directive (`orders-dir.js`), not a backend-managed list/table — trivial to copy the idea but any real reimplementation should make locations data-driven.

## Verdict
Thin but on-topic: a real, if small, hand-rolled asset checkout/checkin + case-packing tracker for a multi-site FRC regional org, with a clean small REST/JWT/Mongoose backend. Worth stealing: the asset/case/product type model with an embedded `inCase` sub-document for "what's packed where," the checkin/checkout-as-upserted-order pattern, and the location-scoped order search. Not worth borrowing: the auth key-file setup (broken/inconsistent as committed) or the vendored-library bulk that makes up most of the repo's size.
