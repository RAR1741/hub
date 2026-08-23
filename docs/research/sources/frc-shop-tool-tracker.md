# FRC Shop Tool Tracker — Source Survey

**Repo:** TheDawnKing24/FRC-shop-tool-tracker — https://github.com/TheDawnKing24/FRC-shop-tool-tracker
**Surveyed-at:** aa807c48f2b134f6b13335c0d867c128b3312a8a
**Permalink form:** https://github.com/TheDawnKing24/FRC-shop-tool-tracker/blob/aa807c48f2b134f6b13335c0d867c128b3312a8a/<path>
**Stack:** JavaScript (ES6) + Vite, Firebase Firestore (client SDK), html5-qrcode
**License:** MIT (LICENSE file present) — free to take ideas/code
**Last activity:** 2026-07-28 (single commit, repo created and pushed same day)
**FRC team:** 6632 (from `<title>FRC 6632 Shop Tracker</title>` in `index.html`)
**Areas:** part design/manufacturing tracking (tool inventory, adjacent to shop tooling — no PO/ordering, no roster, no comms)

## Purpose
A QR-code scanner page intended to look up shop tool inventory info in Firestore when a tool's tag is scanned. As committed, it is a proof-of-concept stub, not a working tracker.

## Auth & Roles
None. No authentication, no user model of any kind.

## Data Model
None implemented. `app.js` imports Firestore's `doc`, `getDoc`, `setDoc` but never calls them — there is no collection/document schema defined anywhere in the repo.

## Features
- **Design/manufacturing (tool tracking) — stub only:**
  - Single-page UI with a "Scan QR Code" button and an `html5-qrcode` reader div (`index.html`)
  - On click, starts the device camera and decodes a QR code, logging the decoded text to the console (`app.js`) — no lookup, no display of tool data, no write-back
  - Firebase Firestore app/config initialization is wired up (`app.js`, placeholder `firebaseConfig` values) but never queried

No other features exist: no checkout/check-in flow, no search/filter, no analytics — all listed in the README's own "Future Improvements" section as not-yet-built.

## Integrations
Firebase Firestore (SDK initialized, unused). No Slack/Discord/email/SMS/Onshape/TBA integration.

## Notable Implementation Details
- Firebase config in `app.js` is left as literal placeholder strings (`"..."`) — never filled in, confirming this never ran against a real database.
- Numbered `console.log("1")`..`console.log("6")` calls throughout `app.js` are leftover debug scaffolding.
- Repo is 22 KB, single commit, no tests, no CI.

## Verdict
Too thin to survey in depth: it's a same-day proof-of-concept with a QR scanner that logs to console and no working inventory read/write, auth, or data model. Nothing concrete worth recreating beyond the general idea (QR-tag-based tool lookup via Firestore), which is already noted in other, more complete inventory-tracker surveys.
