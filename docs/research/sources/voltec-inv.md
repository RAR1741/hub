# voltec-inv — Source Survey

**Repo:** pacoito123/voltec-inv — https://github.com/pacoito123/voltec-inv
**Surveyed-at:** c9c1ecc0231ff46004fd7ffd1939a8d390aa6c30 (get via: gh api repos/pacoito123/voltec-inv/commits --jq '.[0].sha')
**Permalink form:** https://github.com/pacoito123/voltec-inv/blob/c9c1ecc0231ff46004fd7ffd1939a8d390aa6c30/<path>
**Stack:** MERN — Node/Express + Mongoose/MongoDB backend, Create React App + Redux frontend (Materialize CSS), JWT auth, local disk file uploads (multer)
**License:** GPL-3.0 (COPYING file present) — copyleft, ideas only
**Last activity:** 2023-01-07
**FRC team:** #6647 (Voltec, per README/description)
**Areas:** (5) parts ordering/POs — partially (inventory stock levels and "grab"/checkout tracking, no purchasing workflow); general inventory tracking is the closest fit

## Purpose
A single-purpose stockroom inventory tracker: catalog parts with quantities, tag/categorize them, photograph them and their storage location, and let students "grab" (check out) quantities against a running per-item usage log. No purchasing, budgeting, or supplier workflow — it stops at physical stock tracking.

## Auth & Roles
JWT-based auth (`jsonwebtoken` + `bcryptjs`), custom middleware (`middleware/auth.js`) reads an `x-auth-token` header, verifies against a secret (env var in prod, `config` package in dev), and attaches `req.user` (decoded payload: `_id`, `admin`, `name`, `email`). Two roles only: regular user and `admin` boolean flag on `User` (`models/User.js`). Admin-only actions (create/update/delete items and tags) are enforced server-side per-route by checking `req.user.admin` (`routes/items.js`, `routes/tags.js`), not just hidden client-side. Non-admins can still register (`routes/users.js`), log in, and "grab" items. Passwords salted with bcrypt (`genSalt(15)`).

## Data Model
Three Mongoose collections:
- **User** (`models/User.js`): `name`, `email` (unique), `password` (hashed), `admin` (bool, default false).
- **Item** (`models/Item.js`): `name`, `tags` (array of tag strings), `amount` (total quantity), `image` (uploaded file path/URL), `storedIn` (image of the storage bin/shelf, also uploaded via the same image-upload route), `grabbedBy` (array of `{ user, name, amount, date }` — an append-only checkout log), `amountGrabbed` (running total checked out), `timesGrabbed` (counter).
- **Tag** (`models/Tag.js`): single `tag` string field — flat tag list, no hierarchy, used for item categorization/filtering.

No orders/purchase-request entity, no location entity beyond a photo, no audit log beyond the `grabbedBy` array on each item.

## Features
**Parts ordering / inventory tracking (area 5):**
- Item CRUD with admin-only writes: create/update/delete items with name, tag set, total quantity, and photo — `routes/items.js`, `web/src/components/items/ItemModal/ItemModal.js`.
- Stock "grab" (checkout) flow: any logged-in user (or a named person entered by an admin on their behalf) can check out a quantity of an item; the UI enforces the checkout amount can't exceed remaining stock (`amount - amountGrabbed`), then appends a `{user, name, amount, date}` record and increments running totals — `web/src/components/items/GrabModal/GrabModal.js`, `models/Item.js`.
- Per-item usage history is implicit in the `grabbedBy` array (who grabbed how much and when) but there is no dedicated history/report UI shown in the surveyed tree beyond the card back — `web/src/components/items/ItemCard/CardBack/CardTable/CardTable.js`.
- Quantity stepper/"ticker" control shared between add/edit and grab flows for incrementing/decrementing amounts with bounds checking — `web/src/components/layout/Ticker/Ticker.js`.
- Tag-based categorization and filtering: tag CRUD (admin-only) and a tag picker on items — `routes/tags.js`, `web/src/components/tags/TagSelectOptions/TagSelectOptions.js`, `web/src/components/tags/TagList/TagList.js`.
- Search bar for filtering the item list client-side — `web/src/components/layout/SearchBar/SearchBar.js`.
- "Stored in" location captured as a photo of the shelf/bin rather than a structured location field — `web/src/components/items/StoredInModal/StoredInModal.js`.
- Image upload for both item photos and storage-location photos via a single generic upload endpoint (10MB limit, jpeg/png only, disk storage) — `routes/img.js`.

**People/rosters (area 2), tangential:**
- User registration/login only (no roster, no attendance, no team-member directory beyond auth) — `routes/users.js`, `routes/auth.js`, `web/src/components/pages/Register`, `web/src/components/pages/Login`.

## Integrations
None. No email/SMS, no Slack/Discord, no calendar, no CAD/Onshape, no third-party inventory API. Images are stored on local disk (`./images/`) via multer, not an external object store.

## Notable Implementation Details
- All user-facing strings are in Spanish (error messages, labels), consistent with a Spanish-speaking FRC team.
- Server-side admin enforcement is done per-route by hand (`if (!req.user.admin) return res.status(401)...`) rather than centralized middleware/RBAC — an easy pattern to improve on (a single `requireAdmin` middleware) when re-implementing.
- The `PUT /api/items/:id` route takes `req.body[0]`/`req.body[1]` (an array-as-payload convention) to smuggle in an "admin override" flag alongside the item fields, letting a non-admin's grab-update bypass the admin check — a somewhat fragile, implicit authorization backdoor worth avoiding in a re-implementation (prefer a dedicated `/grab` sub-route with its own authz instead of overloading the general update endpoint).
- Images are saved to local disk with a `Date.now()_filename` scheme — no cloud storage, no CDN; would not survive redeploys on ephemeral hosts (e.g., Heroku dynos, which the `heroku-postbuild` script targets) without a persistent volume.
- No pagination on `GET /api/items` — fine at small FRC-team scale but a scale limit if the catalog grows large.
- Tags are a flat unstructured array of strings on each item (not referenced by Tag `_id`), so renaming a tag doesn't cascade to items — a normalization gap.

## Verdict
Substantive small full-stack CRUD app (MERN) worth reviewing for its simple checkout/"grab" ledger pattern (append-only per-item usage log) and photo-based storage-location convention, but it is inventory-tracking only — no purchasing/PO workflow — and is GPL-3.0 copyleft, so only the ideas (checkout ledger, photo-as-location, quantity ticker UX) should be reused, not the code.
