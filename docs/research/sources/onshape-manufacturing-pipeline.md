# onshape-manufacturing-pipeline — Source Survey

**Repo:** https://github.com/Mechanical-Advantage/OnshapeManufacturingPipeline (FRC 6328, Mechanical Advantage)
**Surveyed at commit:** `255941313d5449b90d298f14a8d52e5e8d77305f`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/Mechanical-Advantage/OnshapeManufacturingPipeline/blob/255941313d5449b90d298f14a8d52e5e8d77305f/<path>`

## Purpose

A two-surface manufacturing-tracking tool for FRC Team 6328 that bridges live Onshape part selection to a shared Kanban board. An Onshape right-panel extension (`onshape-panel/index.html`) reads the part a student has selected in a Part Studio, auto-fills machine/material/finish metadata from the CAD itself, and lets the student submit a "manufacturing card" — to Slack (a channel message, a Slack List row, or both) and/or to a standalone Postgres-backed Kanban board (`board/index.html`) that the whole shop can view and drag between statuses. It targets students doing CAD (submitting parts for manufacture) and shop leads/machinists (working the board to track what's cut, in progress, or done).

## Stack

- **Language:** JavaScript only — no build step, no framework. Two single-file HTML documents (inline `<style>` + inline `<script>`, vanilla DOM) plus three Vercel serverless functions.
- **Hosting:** Vercel serverless functions under `api/*.js` (`vercel.json` — root `/` redirects to `/onshape-panel`, per-function memory/duration limits). No server process, no Docker.
- **Database:** Neon serverless Postgres (`@neondatabase/serverless`, `^0.10.4`) for the board's `cards` table — connected via `DATABASE_URL`; no ORM, raw tagged-template SQL.
- **File storage:** Vercel Blob (`@vercel/blob`, `^0.27.0`) for STEP/PDF/thumbnail uploads, `BLOB_READ_WRITE_TOKEN`.
- **Frontend:** No framework — plain HTML/CSS/JS in `onshape-panel/index.html` (1814 lines) and `board/index.html` (1151 lines). Google Fonts (Barlow/Barlow Condensed) for branding; native HTML5 drag-and-drop for the Kanban board; `<script src="https://accounts.google.com/gsi/client">` for Google Identity Services sign-in on the board.
- **License:** none found — no `LICENSE`/`COPYING` file, no license field in `package.json`, no license mention in `README.md`. Treat as all rights reserved.
- **Deployment:** Vercel only (`vercel.json`); `package.json` lists only the two runtime deps, no scripts, no test tooling.

## Auth & Roles

- **Onshape panel:** No login of its own — trust boundary is the Onshape session. It runs as an iframe inside Onshape's right panel; `initOnShape()`/`handleOnShapeMessage()` (`onshape-panel/index.html`) exchange `postMessage` handshakes with the parent Onshape window (`applicationInit`, `SELECTION` events) to learn which document/element/parts are open and selected. The two backing API proxies (`api/onshape.js`, `api/slack.js`) hold the real secrets (`ONSHAPE_ACCESS_KEY`/`ONSHAPE_SECRET_KEY`, `SLACK_TOKEN`) server-side as Vercel env vars — the browser never sees them. There is no per-user identity on this surface; "who submitted" is a free-text name field the student types in.
- **Board:** Google Identity Services sign-in gated by a hardcoded email-domain allowlist. `board/index.html`: `ALLOWED_DOMAIN = 'littletonrobotics.org'`; `handleGoogleSignIn()` decodes the Google JWT client-side (`parseJwt`, no server-side verification) and rejects any email not ending in `@littletonrobotics.org`. Session is persisted only in `localStorage` (`mfg_user_email`/`mfg_user_name`) — no server session, no cookie, no re-verification on subsequent API calls. `api/board.js` itself performs no authentication or authorization at all; any client that can reach the endpoint can read/write/delete every card.
- **No roles.** Every authenticated (or, for the panel, merely embedded) user has full read/write/delete access — single flat permission level on both surfaces.

## Data Model

- **`cards` table** (Postgres/Neon, schema not migration-managed in this repo — inferred from `api/board.js` INSERT/UPDATE columns): `id`, `name`, `status`, `project`, `machine`, `material`, `thickness`, `part_type`, `quantity`, `finish`, `assigned_to`, `cad_link`, `notes`, `step_file_url`, `step_file_name`, `pdf_file_url`, `pdf_file_name`, `part_id`, `submitted_by`, `is_critical` (bool), `thumbnail_url`, `created_at`, `updated_at`. No foreign keys, no other tables — one flat table is the entire board.
- **Status enum** (`board/index.html`, `STATUSES` const, 13 values with display colors): Needs Drawing → Needs CAM → Needs Slicing → In Progress → Ready for Saw / Lathe / Mill / CNC Mill / CNC Router / 3D Printer / Laser Cutter → Needs Powder Coat → Done.
- **Slack side-channel state:** the Slack List (`SLACK_LIST_ID` constant in `api/slack.js`) duplicates a subset of the same fields as List columns, with column IDs and select-option IDs hardcoded as literal strings discovered by an ad-hoc `getListSchema` debug action — several project/machine/material/finish option values are commented as "not yet observed," i.e. incomplete/best-effort mappings.
- **Onshape-side ephemeral state:** in-memory only, held in page-level JS globals in `onshape-panel/index.html` — `faceMap` (built by `buildFaceMap()`, mapping Onshape `selectionId` face/edge IDs to `partId`s) and a client-side `pillState`/history array persisted to `localStorage`, not the database.

## Features

- **Live Part Studio selection sync** — Reading a student's current face/edge/body selection in Onshape via `SELECTION` postMessage events and resolving it to a part. `onshape-panel/index.html` (`initOnShape`, `handleOnShapeMessage`, `resolveSelectionToParts`).
- **Face→part ID bridge** — Onshape's `SELECTION` events return B-rep face/edge IDs, not part IDs; `buildFaceMap()` fetches `bodydetails` for every body in the Part Studio via the `/api/onshape` proxy and indexes every face/edge ID to its owning part, so a raw face click resolves to the correct part. `onshape-panel/index.html`.
- **"Use Selection" banner** — A pulsing banner appears when Onshape reports a live selection; clicking "Use Selection" auto-checks that part in the list. `onshape-panel/index.html` (`useStudioSelection`, `#selection-banner`).
- **Manual part list / refresh / select-all / clear** — Toolbar to reload all parts in the studio (bypassing selection), select all, or clear checkboxes. `onshape-panel/index.html` (`loadParts`, `selectAll`, `clearSelection`).
- **Global project selector** — One project pill (or free-text custom project) applied to every card in a submission batch. `onshape-panel/index.html` (`setGlobalProject`, `globalProjectCustomInput`).
- **Per-part manufacturing card form** — Sequential modal per selected part (`showPartForm`) capturing machine, material+thickness, part type, quantity, finish, assignee (remembered in `localStorage`), CAD link, notes, and a "critical" toggle; Skip/Submit & Next queue navigation (`advanceQueue`, `skipPart`, `submitPart`).
- **Part thumbnail preview** — Fetches a render of the selected part from Onshape and displays it in the form. `onshape-panel/index.html` (`fetchPartThumbnail`).
- **Automatic material detection from CAD** — Matches the Onshape-assigned material's `displayName` (and, for custom materials like team-defined PLA+, its density) against a lookup table to pre-fill the Material pill. `onshape-panel/index.html` (`matchMaterial`, `MATERIAL_MAP`, `MATERIAL_DENSITY_MAP`).
- **Automatic finish/powder-coat-color detection** — Compares the part's assigned RGB color against a blacklist of Onshape's own default colors (to avoid false positives on un-colored parts) and then against the team's actual powder-coat palette by Euclidean color distance, pre-filling the Finish pill only on a confident match. `onshape-panel/index.html` (`matchFinishColor`, `hexToRgb`, `colorDistance`, `ONSHAPE_DEFAULTS`, `POWDER_COAT_COLORS`).
- **Automatic plate/tube/hex-shaft/round-shaft classification** — Four heuristic detectors (`autoDetectPlate`, `autoDetectTube`, `autoDetectHexShaft`, `autoDetectRoundShaft`) that inspect part geometry/bounding data returned from Onshape to pre-select Part Type and, for tube/shaft stock, extract profile dimensions for the notes/description. `onshape-panel/index.html`.
- **STEP / DXF export attached to a card** — `exportStepFile`/`exportDxfFile` request a translation from Onshape (via `/api/onshape`) and upload the resulting file to Vercel Blob through `/api/board` (`uploadStep`/`uploadPdf` actions) so the card carries a downloadable manufacturing file. `onshape-panel/index.html`.
- **Drag-and-drop file attach** — Manual file drop/browse for a PDF drawing alongside or instead of the Onshape-exported file. `onshape-panel/index.html` (`fileDrop`, `fileDragOver`, `setFile`).
- **Submission fan-out to Slack + board** — On submit, a card posts (any combination of) a rich Slack channel message with fielded blocks (`postMessage`), a row in a Slack List with typed select/attachment columns (`addListItem`), and a row in the Postgres `cards` table (`addToBoard`) — `onshape-panel/index.html` (`submitPart`), `api/slack.js`, `api/board.js`.
- **Session submission history tab** — A running list of cards submitted this session (name, tags, meta), independent of the persistent board. `onshape-panel/index.html` (`addToHistory`, `#tab-history`).
- **Demo mode** — `useDemoMode()` loads fabricated parts (`loadDemoParts`) so the panel can be exercised without live Onshape/Slack/DB credentials.
- **Kanban board view** — 13-column drag-and-drop board (`board/index.html`, `buildBoard`, `makeCardEl`, `setupDropZone`) with native HTML5 drag events; dropping a card on a column POSTs `moveCard` to update its status.
- **List view toggle** — A flat, grouped-by-status table alternative to the Kanban board, with collapsible per-status groups. `board/index.html` (`setView`, `buildListView`, `toggleGroup`).
- **Card detail modal / inline edit / delete** — Click a card to open a read-only detail view with STEP/PDF download buttons, or edit fields directly (`openEditModal`, `saveCard`, `confirmDelete`) — delete also removes any attached Blob files (STEP/PDF/thumbnail). `board/index.html`, `api/board.js` (`deleteCard`).
- **New card creation from the board itself** — `openNewCardModal()` lets shop staff add a card directly on the board (not only via the Onshape panel).
- **Filter bar + free-text search** — Dropdown filters (project/machine/material/etc.) plus search, with a live filtered-count. `board/index.html` (`getFiltered`, `populateFilterDropdowns`).
- **Critical-part flag** — A visually distinct toggle (red highlight) on both the submission form and the board card/modal, for parts on the critical path. `onshape-panel/index.html`, `board/index.html` (`is_critical`).
- **Auto-refresh polling** — The board polls the API on an interval to pick up cards added from the Onshape panel by other users. `board/index.html` (`pollCards`).
- **STEP/PDF download from the board** — Per-card download buttons stream the Blob-stored file back to the browser. `board/index.html` (`downloadStep`, `downloadPdf`, `api/board.js` — the file is served by returning its already-public Blob URL, not proxied).
- **Toast notifications** — Lightweight success/error toasts on both surfaces. `onshape-panel/index.html`, `board/index.html` (`showToast`/`toast`).

## Integrations

- **Onshape REST API** — `api/onshape.js` transparently proxies GET/POST calls (bodydetails, translations, thumbnails) to `cad.onshape.com/api/v6` using HTTP Basic auth built from `ONSHAPE_ACCESS_KEY`/`ONSHAPE_SECRET_KEY`, purely to dodge browser CORS; the panel itself talks to the parent Onshape window via `postMessage` for selection state.
- **Slack Web API** — `api/slack.js` posts to `chat.postMessage` (rich card), `files.getUploadURLExternal`/`files.completeUploadExternal` (file share), and `slackLists.items.create`/`slackLists.items.list` (Slack Lists) using a bot token with `chat:write` scope. Slack List column/option IDs are hardcoded, discovered manually and left with several "not yet observed" gaps.
- **Neon serverless Postgres** — `api/board.js`, connection via `@neondatabase/serverless`'s `neon()` tagged-template client, `DATABASE_URL` auto-populated by the Vercel↔Neon integration.
- **Vercel Blob** — `api/board.js`, `put`/`del` for STEP/PDF/thumbnail storage, `BLOB_READ_WRITE_TOKEN`.
- **Google Identity Services** — `board/index.html` loads `accounts.google.com/gsi/client` for the sign-in button; no server-side token verification.
- **Google Fonts** — Barlow/Barlow Condensed webfonts on both pages.

## Notable Implementation Details

- **Single-team, hardcoded configuration throughout.** The Slack List ID, all its column IDs and select-option IDs, the Google auth domain (`littletonrobotics.org`), and the demo-mode data are all literal constants in the HTML — there is no per-team config layer (contrast with PenguinCAM's YAML config system). Reusing this for another team means editing the source directly.
- **No authorization on the board API.** `api/board.js` has no session check, no user identity, no rate limiting — any request that knows the endpoint shape can read, create, update, or delete every card. The Google sign-in on the frontend is purely a UI gate; nothing enforces it server-side. Client-side-only auth (unverified JWT decode + `localStorage` persistence) means a modified client bypasses the domain check entirely.
- **README documents a different origin.** `README.md`'s setup step 4 tells installers to register the Right Panel extension's Action URL as `https://reframe-seantommasini.github.io/Slack-List-Onshape-Integration/`, while the shipped app is versioned "v1.83"/"v2.15" and hosted (per in-app links) at `slack-list-onshape-integration.vercel.app` — the README appears to describe an earlier/different deployment than what's in this repo, or is simply stale.
- **Face-ID-to-part-ID resolution is the load-bearing hack.** Onshape's `SELECTION` postMessage gives you B-rep entity IDs (face/edge/vertex), not `partId`; the whole "click a face, get a manufacturing card" UX depends on `buildFaceMap()` pre-indexing every body's faces/edges via a separate `bodydetails` REST call, since the two ID spaces don't otherwise correspond (documented in code comments in `api/onshape.js` and `onshape-panel/index.html`).
- **Color-distance heuristics for finish detection** are tuned with two hand-picked thresholds (`DEFAULT_SKIP_THRESHOLD = 8`, `MATCH_THRESHOLD = 80`) rather than an exact-match lookup, to tolerate Onshape's float-to-int color rounding while still rejecting ambiguous colors — a deliberately fuzzy, single-team-calibrated heuristic.
- **No test suite, no CI, no migrations.** `package.json` declares only the two runtime dependencies; the Postgres schema is never defined in-repo (must be created by hand against the columns `api/board.js` expects). Given the commit history shows a single squashed commit dated April 2026, prior development history is not visible in this shallow clone.
- **Everything is secrets-server-side by design.** Both `api/onshape.js` and `api/slack.js` exist solely as CORS-avoidance proxies that inject server-held credentials — a deliberate (and correct) pattern to keep API keys out of the browser bundle, at the cost of no per-request authorization on top of it.
