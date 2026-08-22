# Inventory Radar FRC — Source Survey

**Repo:** redwatchsoftwareteam/inventory-radar-frc — https://github.com/redwatchsoftwareteam/inventory-radar-frc
**Surveyed-at:** 8fc57b7fe472521948b938d1909787a0793a1985
**Permalink form:** https://github.com/redwatchsoftwareteam/inventory-radar-frc/blob/8fc57b7fe472521948b938d1909787a0793a1985/inventory-radar-frc/<path>
**Stack:** React 18 + Vite, react-router-dom, Tailwind CSS, Firebase (Firestore + Analytics), no backend framework — client talks to Firestore directly
**License:** none (all rights reserved) — no LICENSE file in the tree; ideas only
**Last activity:** 2024-01-16 (single commit history, `pushed_at` 2024-01-16T01:03:41Z)
**FRC team:** Red Watch Robotics, FRC 2720 (per repo description)
**Areas:** parts ordering/manufacturing tracking (inventory only — no purchasing/PO workflow, no vendor/pricing fields)

## Purpose
A minimal parts-inventory tracker for a single FRC team's physical storage locations (four named closets/rooms). Lets mentors/students record what parts live where and adjust quantity/location as parts are used or moved, so the team doesn't lose track of stock across multiple storage spots.

## Auth & Roles
None. No Firebase Auth, no login screen, no user/role model of any kind. The app is a public Firebase project (client config incl. API key is committed in `src/firebase.js`) with Firestore apparently open to any client that loads the page — anyone with the URL can add/edit/delete inventory rows.

## Data Model
No shared schema — each "closet" page owns its own flat Firestore collection with the same ad hoc shape:
- Collections: `rahul-closet`, `old-closet`, `storage-room`, `bam-closet` (one per physical location, hardcoded per page)
- Document fields: `name` (string), `quan` (quantity, string/number), `location` (free-text string, redundant with the collection itself), auto-generated Firestore doc ID used as the row key
- No relationships, no categories/tags, no vendor, no cost, no min-stock/reorder threshold, no history/audit trail of changes
- Client also mirrors the currently-loaded list into `window.localStorage` (per closet, e.g. `bamData`) purely as a page-load cache, not a sync mechanism

## Features
Parts / manufacturing-tracking area only (no other in-scope areas touched):
- Home page with a 2x2 button grid linking to four hardcoded storage locations — `src/pages/Home.jsx`
- Per-location inventory page, duplicated four times with only the Firestore collection name and closet label changed:
  - `src/pages/Page1.jsx` ("Rahul's Closet (Metalshop)", collection `rahul-closet`)
  - `src/pages/Storage_closet.jsx` ("Storage Room (Metalshop)", collection `storage-room`)
  - `src/pages/Old_closet.jsx` ("Old Closet (D100)", collection `old-closet`)
  - `src/pages/BAM_closet.jsx` ("BAM Closet (D100)", collection `bam-closet`)
- Add a new part: name/quantity/location text inputs + Submit button writes a new Firestore doc and appends it to local state — e.g. `nameSubmit`/`sepFunc` in `src/pages/BAM_closet.jsx:130-158`
- Manual Refresh button pulls the full collection from Firestore into local state (`refresh()` in each page, e.g. `src/pages/BAM_closet.jsx:160-192`) — there's also a live `onSnapshot` listener attached alongside the one-shot `getDocs` fetch, but its change handler is commented out/no-op
- Per-row inline quantity edit: text input + implicit update writes `quan` to Firestore and patches local state (`changeQuan`, `src/pages/BAM_closet.jsx:65-83`)
- Per-row inline location edit: same pattern for `location` (`changeLoc`, `src/pages/BAM_closet.jsx:85-103`)
- Remove-item function exists (`removeItem`, queries by name then deletes the matching doc, `src/pages/BAM_closet.jsx:52-63`) but the UI button that calls it is commented out in the render — dead/disabled feature
- Local persistence of the fetched list to `localStorage` per closet as a warm-cache on reload (`useEffect` pair near top of each page)

## Integrations
- Firebase/Firestore only (`src/firebase.js`) — used purely as the app's database, not for auth or any team-external service
- Firebase Analytics is initialized (`getAnalytics(app)`) but not otherwise referenced
- No Onshape, Slack, Discord, email, SMS, or FRC-event API integration of any kind

## Notable Implementation Details
- Heavy copy-paste duplication: four page files are ~95% identical, differing only in the collection-name string and a couple of labels — a straightforward anti-pattern (should be one `Closet` component parameterized by collection name/location). Worth noting as what NOT to copy structurally, though the underlying feature (per-location inventory list with add/refresh/edit) is simple and reasonable to recreate as a single reusable component.
- No input validation: quantity field is free-text/number with no bounds checking; duplicate part names across "add" calls aren't prevented (each add is a blind `addDoc`, not an upsert).
- `removeItem` does a query-then-delete by `name` match, which is fragile if two rows share a name — no dedup/disambiguation.
- Firestore is queried both via a one-shot `getDocs` (used for actual rendering) and an `onSnapshot` real-time listener whose callback is a no-op — so despite Firestore's real-time capability, the UI does not actually live-update; users must click Refresh.
- Firebase web config (API key, project ID) is committed directly in source (`src/firebase.js`) — normal for Firebase's client-side model (the key is not a secret by itself) but there are apparently no Firestore security rules restricting writes, meaning the whole inventory is publicly writable to anyone who finds the deployed URL.
- Scale: this is a toy/single-team scale — four fixed locations. Trivial to outgrow (adding a new storage location today literally requires copy-pasting a new page file and collection).

## Verdict
Thin but on-topic: a real, if very small, single-team inventory tracker for physical parts storage with basic CRUD (add/edit-quantity/edit-location/list) against Firestore, no auth, no PO/vendor workflow. Worth stealing only the shape of the feature (per-location parts list, quantity/location inline edit, add-new-part form) — the implementation itself (hardcoded per-location duplication, disabled delete, dead real-time listener, no security rules) is a cautionary example rather than a pattern to copy.
