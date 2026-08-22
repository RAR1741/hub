# Aerie Part Management — Source Survey

**Repo:** frc3322/aerie-part-management — https://github.com/frc3322/Aerie-Part-Management
**Surveyed-at:** 218602f234967627c1b59dc8db4725dc70cb2f19 (get via: gh api repos/frc3322/aerie-part-management/commits --jq '.[0].sha')
**Permalink form:** https://github.com/frc3322/Aerie-Part-Management/blob/218602f234967627c1b59dc8db4725dc70cb2f19/<path>
**Stack:** Vanilla JS + Vite frontend (Three.js for 3D preview, Tailwind CSS); Flask (Python) backend with SQLAlchemy ORM (SQLite/PostgreSQL); `cascadio` for STEP→GLB conversion; API-key auth (no user accounts)
**License:** none present in repo — README footer claims "ISC License" but no `LICENSE` file exists in the tree. Treat as ambiguous/unlicensed — ideas only, do not copy code or reuse text verbatim.
**Last activity:** 2026-05-04 (commit date of surveyed SHA)
**FRC team:** 3322 ("Eagle Evolution")
**Areas:** (6) part design/manufacturing tracking (primary); marginal touches on (2) people/rosters via free-text "assigned" names and a leaderboard

## Purpose
A shop-floor part-tracking board for an FRC team's fabrication pipeline: parts move through Review → CNC/Hand-Fab → Completed, each part links back to its Onshape CAD document/drawing, and the system auto-fetches a PDF drawing and a 3D preview (STEP→GLB) so a machinist can see geometry and dimensions without opening Onshape.

## Auth & Roles
- No user accounts. Single shared secret configured server-side (`SECRET_KEY` in `config.json`/env).
- `backend/utils/auth.py`: `require_secret_key` decorator gates every mutating/most read routes; accepts the key via `X-API-Key` header, `api_key` query param, or (deprecated) JSON body field.
- Client stores the key in a cookie (`src/core/auth/auth.js`, `src/features/auth/auth.js`) and shows an auth modal (`src/templates/modals/auth-modal.html`) when a protected action fails; `/api/parts/auth/check` lets the frontend probe validity without triggering a real mutation.
- No per-user roles/permissions — it's a single shared "shop password," not RBAC. Note: `auth.py` logs the provided key and the correct key to stdout/app logger on every check (`print(f"[AUTH_CHECK] ...")`) — a real security smell, worth avoiding in any re-implementation.
- Destructive "wipe all data" flow (`wipeActions.js`, `/api/parts/wipe`) requires re-entering the password plus typing literal "DELETE" as a second confirmation factor.

## Data Model
Single primary entity, `Part` (`backend/models/part.py`, SQLAlchemy):
- Identity: `id` (PK), `uuid` (generated), `part_id` (human-friendly, defaults to first 8 chars of uuid)
- Classification: `type` ("cnc"/"hand"), `category` (workflow stage: review/cnc/hand/completed/misc, indexed), `material`, `material_thickness`, `subsystem` (free-text, from a configurable dropdown list)
- Workflow: `status` (Pending/In Progress/Completed/etc.), `assigned` (free-text name), `claimed_date`, `amount` (quantity, min 1)
- Content: `name`, `notes`, `file` (uploaded model filename, sanitized via `secure_filename`), `onshape_url`, `misc_info` (JSON blob — used to store `handWorkers` history array, `completedIncorrectly` flag, `completed_at` override, etc.)
- Timestamps: `created_at`, `updated_at` (auto-touched on every update)
- `SiteOptions` (`backend/models/options.py`): single-row table holding the configurable `materials` and `subsystems` dropdown lists (defaults: Polycarb/Aluminum/Acrylic; turret/shooter/spindexer/intake/climber/hopper) — lets a team customize taxonomy without code changes.
- No separate Student/User/Order tables — "assigned"/leaderboard names are plain strings, not FKs to a roster.

## Features

### Part design/manufacturing tracking (core area)
- **Kanban-style pipeline** across four tabs — Review, CNC, Hand Fab, Completed (`src/features/tabs/{review,cnc,handFab,completed}.js`, `backend/routes/parts.py` category routes) — plus a Misc tab for non-standard items.
- **Review → approve/assign → claim/unclaim → complete → revert** state machine (`POST /api/parts/<id>/approve|assign|unclaim|complete|revert` in `backend/routes/parts.py`); revert lets a mistakenly-completed part go back a stage.
- **Multi-worker attribution**: hand-fab parts track a list of past workers (`_append_hand_worker` in `parts.py`, stored in `misc_info.handWorkers`) so credit/blame survives reassignment.
- **Quantity-aware parts**: `amount` field lets one row represent a batch; stats/leaderboard sum by `amount` rather than row count.
- **"Completed incorrectly" flag** — a part marked done wrong applies a -2 point penalty to whoever claimed it (see Leaderboard below), instead of silently deleting history.
- **Onshape CAD integration**: parts store a raw Onshape document/workspace/element URL (`onshape_url`); `backend/utils/onshape_drawing.py` (`OnshapeDrawingClient`) parses that URL and calls the Onshape "translations" API to render the drawing sheet to PDF server-side, cached and served via `GET /api/parts/<id>/drawing`. Frontend drawing viewer: `src/features/parts/drawingViewer.js`.
- **STEP → 3D preview pipeline**: uploaded STEP files are converted server-side to GLB via `cascadio` (`backend/utils/step_converter.py`, tolerances configurable) and served at `GET /api/parts/<id>/model`; the browser renders it with Three.js (`src/components/threeDViewer.js`). Multi-angle static view images can also be uploaded/served (`POST/GET /api/parts/<id>/views`, `.../views/<index>`) as a lighter-weight fallback to full 3D.
- **File upload/download** with extension allow-listing and per-part upload directories (`allowed_file`, `get_upload_path` in `parts.py`); filenames sanitized with `secure_filename` both on model write and route logic (defense in depth against path traversal).
- **Live search/filter** across name, notes, subsystem, assigned, material, part_id (`Part.search_parts`, ORM `ilike` OR-filter) surfaced as an "Advanced Search" bar per team's README.
- **Stats dashboards**: `/api/parts/stats` (simple counts by category/status/assignment) and `/api/parts/stats/detailed` (completion-time distribution bucketed into <1h/1-4h/4-8h/8-24h/>24h, average completion time computed from `claimed_date`→`completed_at`, per-type and per-category totals, top-5 contributors) — feeds dashboard/chart UI.
- **Leaderboard**: `/api/parts/leaderboard` — scoring model: 1 point to current assignee (−2 if flagged completed-incorrectly), 0.5 points to each prior hand-fab worker recorded in `misc_info.handWorkers`, aggregated and sorted (`src/features/tabs/leaderboard.js` renders medal icons for top 3 with proportional bar chart).
- **Configurable dropdowns**: materials/subsystems editable at runtime through `SiteOptions` + an options modal (`src/features/modals/optionsModal.js`, `backend/routes/options.py`) rather than hardcoded enums.
- **Bulk "wipe all data"** with typed-confirmation + password re-entry safety gate (`wipeActions.js`, `POST /api/parts/wipe`) — deletes all DB rows and clears the uploads directory.
- **Automated SQLite backups**: `backend/utils/backup.py` runs a daily background thread, uses SQLite's native backup API (WAL-safe), retains last 10 days by default, configurable retention/interval.
- **Responsive/mobile UI**: dedicated `src/css/mobile.css`, mobile-specific state flags (`appState.isMobile`) hiding desktop-only affordances (e.g., action-key hint).
- **Notifications/toasts, modal manager, confetti** on completion (`src/core/dom/notificationManager.js`, `modalManager.js`, `src/utils/confetti.js`) — polish rather than core feature, but shows an event-driven celebratory UX pattern worth noting.

## Integrations
- **Onshape**: server-side API-key (access/secret) auth to Onshape's REST API for drawing→PDF translation (`backend/utils/onshape_drawing.py`); credentials configured via `create_config.py`/`config.json`. No OAuth — uses Onshape's classic API key pair.
- No Slack/Discord/email/SMS/TBA integration found.

## Notable Implementation Details
- Backend is a clean small Flask app: blueprints (`parts_bp`, presumably an `options_bp`), a single `Part` SQLAlchemy model, thin route layer, and separated `utils/` for auth, validation, backup, onshape, step-conversion — a reasonable reference architecture for a from-scratch Flask CRUD+file-pipeline app.
- Frontend has no framework (no React/Vue) — hand-rolled reactive state (`src/core/state/reactiveState.js`), event delegation (`src/core/dom/eventDelegation.js`), and an HTML-template-based render approach (`src/templates/**/*.html` fetched/interpolated) plus a small API client/router layer (`src/core/api/{apiClient,router,endpoints,partsApi}.js`). Useful pattern reference for a lightweight non-SPA dashboard.
- Security smell to avoid copying: `auth.py` prints and logs the submitted API key and the correct key together on every auth check — an accidental credential-logging bug.
- Rate limiting for auth checks is a bare in-memory dict (`_auth_check_timestamps`) with manual expiry/cleanup and a hard 1000-IP cap — fine for a single small Flask instance behind one dev server, would not survive multi-worker/gunicorn deployment without a shared store.
- `wipe` endpoint requires the password again in the request body (not just already-authenticated header) as a second confirmation channel — a reasonable pattern for irreversible bulk-delete actions generally.
- STEP→GLB conversion depends on an optional native library (`cascadio`); route degrades gracefully with an explicit error dict if the import fails, rather than crashing.
- Very thorough auto-generated internal docs under `code-docs/` (architecture, API reference, models, frontend modules) — worth a skim if deeper implementation fidelity is ever needed beyond this survey, though they're derivative of the same source already read here.
- Single-tenant/single-secret design: fine for one team's shop floor, would need real multi-user auth (individual accounts, robust roles) to extend past "everyone shares one password."

## Verdict
Substantive and squarely in-scope for part design/manufacturing tracking — the CNC/hand-fab/completed pipeline, Onshape drawing+3D-preview integration, per-worker leaderboard scoring, and completion-time analytics are all concrete, well-implemented ideas worth reproducing (not copying, no license). Most reusable ideas: the review→claim→complete→revert state machine with multi-worker attribution history, the "completed incorrectly" scoring penalty, and the STEP→GLB in-browser 3D preview pipeline.
