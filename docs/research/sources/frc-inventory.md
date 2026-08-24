# FRC-Inventory — Source Survey

**Repo:** vinsel2011-lgtm/FRC-Inventory — https://github.com/vinsel2011-lgtm/FRC-Inventory
**Surveyed-at:** d521bd699a59b1412a0fea49071684190da40b1f (get via: gh api repos/vinsel2011-lgtm/FRC-Inventory/commits --jq '.[0].sha')
**Permalink form:** https://github.com/vinsel2011-lgtm/FRC-Inventory/blob/d521bd699a59b1412a0fea49071684190da40b1f/<path>
**Stack:** Static HTML + vanilla JS (ES module), Firebase Firestore (client SDK, config unset)
**License:** none (no LICENSE file, no header) — ideas only
**Last activity:** 2026-06-29 (single commit, "Add files via upload")
**FRC team:** unknown (no team number anywhere in the repo)
**Areas:** (5) parts ordering/POs — nominally; (6) part design/manufacturing (repair tracking) — nominally, but neither is actually implemented

## Purpose
A bare-bones single-page inventory tracker intended to let a team log parts on hand, flag low-stock items, and record repairs. As committed it is a rough prototype/scaffold, not a working tool.

## Auth & Roles
None. No login, no user model, no access control of any kind. The Firestore config is entirely placeholder (`YOUR_API_KEY`, `YOUR_AUTH_DOMAIN`, `YOUR_PROJECT_ID`), so the app cannot even connect to a real backend as committed.

## Data Model
A single Firestore collection, `inventory`, with documents keyed by item name and fields: `name`, `quantity`, `threshold`, `location`, `category`. That is the entire data model — no orders, no purchase records, no repair records, no history/audit trail.

## Features
- **Inventory (parts ordering area, weak):** add/update an item via a form (name, quantity, low-stock threshold, location, category), written directly to Firestore — `index.html.txt` (form markup), `app.ja.txt:72-99` (`setupInventoryForm`, upsert via `setDoc` keyed by item name, so name is effectively a primary key and re-adding the same name overwrites it).
- **Dashboard low-stock view:** re-derives a "Low Stock Items" list client-side by comparing `quantity <= threshold` on every full reload — `app.ja.txt:32-70` (`loadInventory`). No stored/denormalized flag, no server-side query, no notification — purely computed by re-fetching and re-scanning the whole collection each time.
- **"Repairs" page (manufacturing/repair tracking area, not implemented):** just an embedded Google Form iframe with a placeholder form ID (`YOUR_FORM_ID`) — `index.html.txt:69-78`. There is no code reading form submissions back into the app; it's a dead link to a form that doesn't exist.
- **Client-side page routing:** three-tab nav (Dashboard/Inventory/Repairs) toggled by a global `showPage()` function that adds/removes a `.hidden` class — `app.ja.txt:22-30`.

## Integrations
- **Firebase/Firestore** (client SDK, ESM import from gstatic CDN) as the sole datastore — config is a placeholder, never filled in — `app.ja.txt:1-20`.
- **Google Forms** embedded via iframe as the intended repair-logging mechanism, also placeholder — `index.html.txt:73-77`. Nothing in the repo reads Google Forms responses; this is not really wired to anything.
- No PO/vendor integration, no email/SMS, no Slack/Discord, no auth provider.

## Notable Implementation Details
- Files are stored with odd extensions (`index.html.txt`, `app.ja.txt`) rather than `.html`/`.js` — suggests this was pasted/uploaded rather than pushed from a working project; unclear if it ever ran as a deployed site (the repo's `homepage` metadata points to `frc-inventory.vercel.app`, but that is unverified and the client-side Firebase config would fail to connect as committed).
- No build tooling, no package.json, no tests, no CI. Everything is two files.
- Firestore document ID = item name means duplicate/renamed items silently collide or orphan; there's no separate stable ID, no quantity history, no "who changed this and when."
- Low-stock detection is a full client-side re-scan on every load with no caching or backend query — fine at tiny scale, would not scale past a handful of items, and there's no reason to reproduce this scan-based pattern rather than a stored flag or a proper query.

## Verdict
Too thin to be a real reference implementation: two placeholder files, no auth, no working integrations, no repairs logic, single one-time upload commit. Nothing here is worth reusing beyond the very generic idea of "a low-stock dashboard view computed from quantity vs. threshold" — which is such a standard pattern it doesn't need this source. Recommend excluding from the main survey set or listing only as a negative example (a "typical vibe-coded stub" data point) rather than a feature source.
