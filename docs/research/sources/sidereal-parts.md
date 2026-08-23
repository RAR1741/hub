# sidereal-parts — Source Survey

**Repo:** smshfrc/sidereal-parts — https://github.com/smshfrc/sidereal-parts
**Surveyed-at:** ec13776e34cdc37e61ee2557cb2976504ce0293f
**Permalink form:** https://github.com/smshfrc/sidereal-parts/blob/ec13776e34cdc37e61ee2557cb2976504ce0293f/<path>
**Stack:** Node.js/Express backend (ESM, Prisma ORM + PostgreSQL), React 18 + TypeScript + Vite + Tailwind v4 frontend, JWT auth, deployed backend on Render + frontend on Cloudflare Pages
**License:** none (all rights reserved) — no LICENSE file present; ideas only
**Last activity:** 2026-07-28 (commit ec13776)
**FRC team:** 9501 (confirmed via `USER_GUIDE.md`: "FRC 9501 · https://part.team9501.org")
**Areas:** (5) parts ordering — partially (COTS/BOM item tracking), (6) part design/manufacturing tracking — primary focus

## Purpose
A mobile-first task board for managing part fabrication work on an FRC team: members claim machining tasks off a shared queue (CNC, 3D print, laser, etc.), track them through processing/post-processing/review states, and earn points for completed work. It integrates directly with Onshape so tasks can be created from CAD documents/assemblies, complete with thumbnails, BOM import, and part-to-DXF/STL file generation for the machine operator.

## Auth & Roles
- Custom JWT auth (`backend/src/utils/jwt.js`, `middleware/auth.js`): username/password login, bcrypt-hashed passwords (`utils/password.js`), short-lived access token + refresh token (hashed at rest in `RefreshToken` table, not raw).
- Two roles via a `Role` lookup table: `admin` and `member`, enforced with `requireRole(...allowed)` in `middleware/rbac.js`. Admin-only endpoints include master-data settings, robot/subsystem management, task force-review, and point ledger admin views.
- `authenticate` middleware re-checks `isActive` on every request (disabled accounts are rejected even with a still-valid token) — `backend/src/middleware/auth.js`.
- Per-user Onshape OAuth binding is separate from platform auth (`OnshapeAccount` model) — each member links their own Onshape identity; tokens are AES-256-GCM encrypted at rest (`backend/src/utils/cryptoBox.js`) and the frontend never touches raw Onshape tokens (backend proxies all API calls).

## Data Model
Prisma schema (`backend/prisma/schema.prisma`), PostgreSQL, ~20 models:
- **Users/roles/points**: `User`, `Role`, `RefreshToken`, `UserPointsLedger` (immutable per-task-per-reason ledger, unique on `[taskId, userId, reason]` so machining and post-processing credit the same person separately), `PointTransfer` (peer-to-peer point transfers).
- **Robots/organization**: `System` (subsystem categories, also used as part-number prefix), `Robot`, `RobotSubsystem` (per-robot, per-system breakdown), letting a team track multiple robot builds/seasons at once.
- **Task**: the core entity — part number (auto-generated `PREFIX-0001` sequence, versioned by `revision`/`revisionStatus` with supersession chains), manufacturing method, material, post-process, quantity, urgent flag with audit fields (`urgentById`/`urgentAt`/`urgentReason`), machining time extension, status-reminder snooze state, and a full Onshape reference (document/workspace-version-microversion/element/part ids, config string, revision, cached thumbnail). Status is an 8-state enum: `pending → accepted → processing → post_processing → pending_review → completed / rejected / cancelled`.
- **TaskStatusHistory**: append-only audit trail of every status transition with actor.
- **TaskAssignmentTransfer**: records when a task's assignee changes mid-flight (with reason), separate from status history.
- **PrintBatch / PrintBatchTask**: groups multiple 3D-print tasks into one physical print-bed batch owned by one member.
- **ManufacturingMethod**: configurable methods (CNC, lathe, 3D print, laser, etc.) each with `basePoints` per unit, `requiresReview` (admin sign-off gate), `occupancy` (`blocking` vs `automatic` — blocking methods lock the operator to one job at a time; automatic ones like 3D printers don't), and `reminderMinutes` for stale-task nudges.
- **OnshapeAccount**: per-user encrypted OAuth token pair + expiry.
- **OnshapeImportBatch / CotsItem**: BOM import runs from an Onshape assembly; each run creates fabricated-part tasks plus `CotsItem` rows for off-the-shelf/purchased parts (kind `cots` or `skipped`), with collection-quantity tracking (`isCollected`/`collectedQuantity`) — this is the closest the repo gets to parts-ordering functionality.
- **TaskNumberSequence**: a dedicated per-prefix counter row updated with atomic increment inside a transaction, with self-healing logic that jumps ahead if the counter ever falls behind the actual max sequence (`backend/src/utils/partNumber.js`).

## Features

### Part design / manufacturing tracking (primary area)
- Kanban-style task board (pending / in-progress / done) — `frontend/src/pages/Board.tsx`.
- Full task lifecycle with role-gated transitions and validity checks — `backend/src/constants/taskStatus.js`, `backend/src/services/task.service.js`.
- **Blocking vs automatic machine occupancy**: a member can only hold one active "blocking" job (e.g., CNC) at a time; automatic methods (e.g., a 3D printer running unattended) don't block the operator — enforced by `assertNoBlockingWork`/`assertMachineAvailable` in `backend/src/services/task.service.js`.
- **Split machining/post-processing credit**: a task can be picked up by one member to machine and released back to the pool for a *different* member to post-process (anodize, sandblast, etc.), each earning separate points — `backend/src/services/task.service.js` (`POST_PROCESS_POINTS_PER_UNIT`), `USER_GUIDE.md` §3.
- **Admin review gate**: methods flagged `requiresReview` force a `pending_review` status before `completed`; rejections bounce the task back to `processing` and are flagged (`reviewRejected`) for the operator.
- **Urgent flagging** with actor/timestamp/reason audit fields.
- **Part revisioning**: a part number can have multiple revisions; only one is `current`, older ones auto-archive with a `supersededById` pointer — schema migration `20260712030000_part_revision`.
- **Print batching**: group several 3D-print tasks queued on one owner into a `PrintBatch`, track batch status independent of individual task status — `PrintBatch`/`PrintBatchTask` models, migration `20260712010000_occupancy_print_batches_reminders`.
- **Stale-task reminders**: tasks sitting in accepted/processing get a computed `nextStatusReminderAt` based on the method's `reminderMinutes`, with a snooze/response field so a member can dismiss a nudge — `frontend/src/components/ProcessingTimeAlert.tsx`, `task.service.js` (`nextReminderAt`).
- **Machining time extension**: an operator can request more time on a job (`machiningExtensionMinutes`) before it's flagged overdue.
- **Assignment transfer with audit trail**: reassigning a task to another member records who changed it and why (`TaskAssignmentTransfer`).
- **STEP → DXF conversion for laser/CNC-plate parts**: uses `replicad`/`replicad-opencascadejs` (OpenCascade WASM) to import a STEP file, extract the flat face outline, and emit a DXF via `@tarikjabiri/dxf` — `backend/src/utils/stepToDxf.js`, exercised in `backend/tests/step-to-dxf.test.js`. Download format is chosen per task (STL for 3D print, DXF for laser or CNC-on-plate-material) in `backend/src/utils/taskDownload.js`.
- **Machining schedule / leaderboard / robot & subsystem detail views** — `frontend/src/pages/MachiningSchedule.tsx`, `Leaderboard.tsx`, `Robots.tsx`, `SubsystemDetail.tsx`.
- **Points ledger + peer-to-peer point transfer** with atomic conditional-update balance checks (no negative balances) — `backend/src/services/points.service.js`.
- **Master-data admin settings** (systems, methods, materials, post-processes, robots/subsystems) — `frontend/src/pages/MasterDataSettings.tsx`, `backend/src/controllers/meta.controller.js`.

### Third-party integration (Onshape)
- Full OAuth2 flow (per-user), signed short-lived JWT used as CSRF-safe `state` since the callback is a bare browser redirect with no Authorization header — `backend/src/services/onshape.service.js`.
- Token encryption at rest, auto-refresh on expiry (single retry), 401 surfaces as "reconnect required."
- Backend-proxied Onshape API access (parts list, BOM, thumbnails) so the frontend/browser never sees raw tokens — `backend/src/routes/onshape.routes.js`, `backend/src/controllers/onshape.controller.js`.
- **BOM import pipeline**: preview an Onshape assembly's BOM, classify items as fabricated part vs COTS vs "skip", then bulk-create `Task`s + `CotsItem`s in one `OnshapeImportBatch` — `frontend/src/pages/ImportOnshape.tsx`, `ImportItems.tsx`, tested in `backend/tests/onshape-classify.test.js`.
- Onshape URL parsing utility resolves document/workspace-version-microversion/element ids from a pasted document link — `backend/src/utils/onshapeUrl.js`.
- Assembly-level "how much of this design is fabricated yet" progress endpoint (`assemblyProgress`).
- Companion Onshape sidebar Extension described in `ONSHAPE_SETUP.md` (M4 milestone) for deep-linking from inside Onshape itself.

## Integrations
Onshape (OAuth2, REST API proxy, BOM import, thumbnails, part-to-file conversion) is the only external integration. No Slack/Discord/email/SMS/TBA integration found.

## Notable Implementation Details
- Ships a working **CAD-to-manufacturing-file pipeline** (STEP→DXF via WASM OpenCascade) — the most technically distinctive feature in the whole survey set; worth studying even though replicad/opencascadejs is a heavy dependency (large WASM binary) for a self-hosted free-tier Render backend.
- Concurrency-safe part numbering: atomic increment plus a self-healing "resync to actual max" step guards against a reset/restored DB leaving the counter behind, backstopped by a DB unique constraint as last resort — `backend/src/utils/partNumber.js`.
- Points ledger uses a conditional `updateMany` (`totalPoints >= points`) for atomic debit instead of read-then-write, avoiding a race on concurrent transfers — `backend/src/services/points.service.js`.
- Machine "occupancy" concept (blocking vs automatic) is a clean generalizable pattern for any shop tracking tool that mixes attended (mill, lathe) and unattended (printer, oven) processes.
- Deployed on free tiers (Render backend cold-starts, per `USER_GUIDE.md`'s "後端啟動中" 30–60s wake-up note) — a real small-team budget-friction pattern worth remembering when recommending hosting to other mentors.
- All product docs (`USER_GUIDE.md`, `USER_MANUAL.md`, `ONSHAPE_SETUP.md`) are written in Chinese for team 9501's members — content is still directly portable, just requires translation context.
- No LICENSE file; treat as ideas-only per ground rules.

## Verdict
Substantive and directly relevant — a real, actively developed (SHA from Jul 2026) FRC part-fabrication task tracker with genuine backend depth (Prisma schema, JWT auth, RBAC, encrypted OAuth tokens) and a standout feature (STEP→DXF conversion via WASM OpenCascade) not seen elsewhere in this survey set. Worth stealing: the blocking/automatic machine-occupancy model, split machining/post-processing point credit, self-healing atomic part-number sequencing, and the STEP-to-DXF-on-demand download pattern.
