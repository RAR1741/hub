# Tiger Den (den.tigerdynasty.app) — Source Survey

**Repo:** https://github.com/heatonk/TigerDen (FRC Team 5010 "Tiger Dynasty", Fishers HS, Fishers IN)
**Surveyed at commit:** `45045ad374dda4b7d858c0748ae05d5e34260b21`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/heatonk/TigerDen/blob/45045ad374dda4b7d858c0748ae05d5e34260b21/<path>`

**Provenance:** Phase-1 surveyed the hosted app at `den.tigerdynasty.app` from the outside only
(closed-source at the time, no repo found). This repo was located and verified in a follow-up
pass: every fingerprint from the outside survey is present — API routes `/api/scrape-part`,
`/api/time/clock-in`, `/api/time/clock-out`, `/api/boxes`, `/api/requests`, `/api/print/jobs`,
`/api/settings/mentor-emails`; prefixed random IDs (`req_…`, `board_…`, `job_…`, generated via
`crypto.randomBytes(...).toString("hex")`, `server.ts:895,1838,1059`); the midnight sweep that
auto-closes open time sessions backdated to the Google-Calendar meeting end time
(`server.ts:2305-2337`); guest access enforced per-endpoint server-side (`server/acl.ts`); and a
named printer fleet (`server.ts:1013-1030`, table `printers` in `server/db.ts`). **Confirmed
match.** The repo's own docs describe the live deployment as `inventory.tigerdynasty.app`
(`.env.example:54`, `DEPLOY.md`) / `inventory.kyleheaton.xyz` (`DEPLOY.md:4`) rather than
`den.tigerdynasty.app` — the team appears to have renamed the subdomain at some point; team
identity (FRC 5010 "Tiger Dynasty"), feature set, and every API fingerprint are otherwise
identical.

## Purpose

Tiger Den (repo name "FRC Shop Inventory") is a self-hosted internal-operations app for FRC Team
5010: shop **inventory management** with color-tagged storage boxes, a **3D-print job queue**,
**time tracking / meeting attendance**, **purchase requests** with an approval workflow, a
**task board with an auto-scheduling Gantt chart**, a **members/subteam roster**, mentor
check-ins, out-of-office tracking, a suggestion box, and an audit trail. Per `README.md`, it was
"originally built in Google AI Studio (React + Firebase); ported to a fully self-hosted stack" —
the Firestore backend replaced with an Express API and SQLite, Google sign-in replaced with a
central ID/PIN + Google-mentor scheme.

## Stack

- **Frontend:** React 19 + Vite 6 SPA, Tailwind CSS 4 (`@tailwindcss/vite`), `lucide-react` icons,
  `motion` for animation. Single bundle, no client-side router (`src/App.tsx` drives pages by
  state). `package.json`.
- **Backend:** Express 4 in the same Node process, entry `server.ts`, helpers under `server/`
  (`acl.ts`, `auth.ts`, `calendar.ts`, `csv.ts`, `db.ts`, `docs.ts`, `mailer.ts`, `pin.ts`,
  `version.ts`). Built with esbuild to `dist/server.cjs` (bundled CJS, `packages=external`);
  client built by Vite. `package.json` (`build`/`start` scripts).
- **Database:** SQLite via `better-sqlite3`, one file `data/inventory.db` (`DATA_DIR` env var),
  WAL mode. Schema is plain `CREATE TABLE IF NOT EXISTS` in `server/db.ts` — no migration
  framework; all IDs are app-generated prefixed random strings (`crypto.randomBytes(...).toString
  ("hex")`), not auto-increment. `server/db.ts`.
- **Auth:** custom HMAC-signed cookie session (`frc_session`, `server/auth.ts`) — students sign in
  by ID number alone; mentors by Google Identity Services (verified server-side) or ID + PIN
  (`server/pin.ts`); a `.env` `SUPERADMIN_EMAILS` allowlist bumps a mentor to `superadmin`. Raw ID
  numbers are never stored — only an HMAC keyed hash (`hashLookup`, `server/auth.ts:105`) for
  lookup. No session at all = guest.
- **Uploads/mail/calendar:** `multer` (100 MB cap, print-job model files, `server.ts:992`),
  `nodemailer` (`server/mailer.ts`), `node-ical` polling a Google Calendar ICS feed
  (`server/calendar.ts`), `jose` (Google ID-token verification).
- **License:** none found — no `LICENSE`/`COPYING` file, no `license` field in `package.json`
  (`"private": true`). All rights reserved by default.
- **Testing/CI:** Vitest API regression suite (`tests/api.test.ts`, `tests/version.test.ts`,
  `supertest`); `CLAUDE.md` documents `npm run build && npm test` as the pre-deploy gate, no CI
  file in the repo — gating appears to be a local/agent-enforced convention, not a workflow file.
- **Deployment:** self-hosted Proxmox LXC, Caddy reverse proxy, Cloudflare Tunnel, systemd unit
  `frc-inventory.service` (`DEPLOY.md`). Matches the outside survey's Caddy/Cloudflare/Express
  fingerprint exactly.

## Auth & Roles

- **Roles** (`src/permissions.ts`): `student` (rank 1) < `lead` (rank 2) < `mentor` (rank 3) <
  `superadmin` (rank 4); a guest/no-session request is rank 0. Every gated action in the app maps
  to a minimum rank in one file, `PERMISSIONS` in `src/permissions.ts` — e.g.
  `inventory.view`/`edit` → student, `inventory.delete` → lead, `inventory.import` (Sheets
  bootstrap) → superadmin, `requests.decide`/`time.review`/`members.manage` → mentor,
  `settings.superadmin` (mentor-email allowlist) → superadmin. `docs/PERMISSIONS.md` documents the
  checklist for adding a new gated action.
- **Server enforcement:** `requirePermission(action)` (`server/acl.ts:26`) wraps every route; it
  401s with no session, 403s if the session's rank is below the action's required rank. There is
  no rank-0-visible action in the current permission map — **every** listed action requires at
  least `student`, so an anonymous/no-cookie request is refused everywhere, not just on
  admin-only endpoints (`server/acl.ts`, `src/permissions.ts`). This is stricter than the Phase-1
  outside survey's observed "browse the whole app read-only as a guest" — either the deployed
  instance the outside survey hit was configured/versioned differently, or guest browsing has
  since been tightened; the *mechanism* the outside survey inferred (a real server-side session
  with per-endpoint gates, not client-side hiding) is exactly what this code implements.
- **Client mirror:** `src/acl.ts` (`can(user, action)`) reproduces the same rank table so the UI
  hides what the API would refuse; both import the single source of truth `src/permissions.ts`.
- **Student sign-in:** `POST /api/auth/id` — ID number only, checked as `hashLookup(idNumber)`
  against `members.idHash`; rate-limited per IP (10 failures / 10 min → 429); a `pending` member
  (self-requested, unapproved) is refused with a distinct message. `server.ts:527-573`.
- **Mentor sign-in:** Google ID token (`POST /api/auth/google`, verified via `jose`, admitted only
  if the email is on the mentor allowlist or is a superadmin), or ID + PIN if no Google account
  (`server/pin.ts`, `verifyPin`). `server.ts:715-770`.
- **Self-service account request:** `POST /api/auth/request-account` inserts a `pending` student
  row; no session is issued; a mentor must approve before the ID can sign in. `server.ts:587-624`.
- **Profile-completion gate:** students/leads without a first name, last name, and email on file
  get `profileComplete: false` from `GET /api/auth/me` and are blocked behind
  `src/components/ProfileGate.tsx` until they `PATCH /api/me/profile`. `server.ts:660-679`.
- **Superadmin:** a mentor whose email is in `SUPERADMIN_EMAILS` (env) or the DB-backed
  `mentorEmails` setting; `isSuperadminEmail`/`getSuperadminEmails`, `server/auth.ts:64-75`.

## Data Model

All tables in `server/db.ts`, `TEXT PRIMARY KEY` ids, no foreign-key constraints (app-level
integrity only):

- **inventory** — parts/equipment: `name`, `sku`, `quantity`, `minQuantity` (low-stock threshold),
  `supplier`, `unitPrice`, `purchaseUrl`, `lastPurchasedDate`, `boxId`, `category`, `unit`,
  `notes`, `updatedAt/By`.
- **boxes** — `label` (unique), `color` (tag), `location` (shop coordinate).
- **requests** — purchase requests: `itemName`, `itemId` (link to inventory), `quantity`,
  `unitPrice`, `supplier`, `purchaseUrl`, `notes`, `requestedBy/At`, `status`
  (`pending`/`approved`/`rejected`/`completed`), `decisionNotes`, `signedOffBy`, `sku`.
- **logs** — inventory activity log: `itemId/Name`, `activityType`, `amountChanged`,
  `previousQuantity`, `newQuantity`, `timestamp`, `userEmail`.
- **printers** — 3D-printer fleet: `name`, `notes`, `active` flag.
- **print_jobs** / **print_logs** — job queue: `title`, `fileName`/`storedName`, `fileSize`,
  `printerId`, `filamentType`, `color`, `quantity`, `category`, `strength`, `status`
  (`queued`/`printing`/`done`/`failed`/`cancelled`), submit/print/finish by+at, `location`;
  `print_logs` is a per-job activity trail.
- **members** — roster: `name`/`firstName`/`lastName`, `role` (`student`/`mentor`), `lead` flag,
  `pinHash`, `idHash` (both HMAC, never raw), `subteam`, `gradYear`, `email`, `active`, `pending`.
- **subteams** — `name`, `sortOrder`.
- **time_entries** — clock sessions: `memberId/Name`, `source` (`clock`/manual), `startAt`,
  `endAt`, `minutes`, `note`, `updatedBy/At` (set to `'auto (midnight)'` by the sweep).
- **meetings** — calendar-derived: `uid`, `title`, `startAt/endAt`, `endOverride` (mentor
  correction), `allDay`.
- **boards** / **tasks** — Kanban+Gantt: boards have `name`/`sortOrder`; tasks have `boardId`,
  `title`, `description`, `status` (`todo`/`in-progress`/`done`), `startDate/endDate`, `owner`,
  `dependsOn` (comma-separated predecessor task IDs), `durationDays`, `sortOrder`.
- **audit** — `at`, `actor`, `role`, `area`, `action`, `summary`, `entityId`.
- **suggestions** — `submittedBy`, `role`, `category`, `message`, `status`, `adminNotes`.
- **settings** — generic key/value (`mentorEmails`, site settings).
- **changelog** — "What's New" posts: `version`, `type`, `title`, `body`, `createdBy/At`.
- **checkins** — mentor–student check-in stamps: `memberId`, `at`, `byMemberId/Name` (date-only,
  no notes, mentor-visible only).
- **absences** — out-of-office per meeting day: `memberId`, `day` (`UNIQUE(memberId, day)`).
- **access_requests** — external-tool access asks (GitHub/Onshape/etc.): `app`, `details`,
  `status`, `decisionNote`, `decidedBy/At` — tracks the ask/decision only, does not provision
  real access.

## Features

Each entry: description, then server route(s) and the primary React component.

### Authentication & account lifecycle
- **Guest read-only landing** — unauthenticated visitors see a downgraded, mostly view-only UI (no
  server-side action succeeds at rank 0 in the current permission map). `src/App.tsx`,
  `src/acl.ts`.
- **Sign in by ID (students) / Google or ID+PIN (mentors)** — `LoginDialog.tsx`;
  `POST /api/auth/id`, `POST /api/auth/google`, `GET /api/auth/config`. `server.ts:528-573,
  709-770`.
- **Self-service account request, pending mentor approval** — `POST /api/auth/request-account`;
  `server.ts:587-624`.
- **Profile-completion gate** (first/last name + email required before full access) —
  `ProfileGate.tsx`; `PATCH /api/me/profile`. `server.ts:660-679`.
- **Mentor allowlist management (superadmin only)** — `MentorAccessSettings.tsx`;
  `GET/PUT /api/settings/mentor-emails`. `server.ts:693-707`.
- **Logout** — `POST /api/auth/logout`. `server.ts:626-629`.

### Shop Inventory
- **Parts/equipment catalog** with box, supplier, price, low-stock threshold, category, unit —
  `InventoryTable.tsx`, `ItemDialog.tsx`; `GET/POST /api/inventory`,
  `PATCH /api/inventory/:id/quantity`, `DELETE /api/inventory/:id`. `server.ts:771-857`.
- **Google-Sheets bootstrap import** (paste a link-shared sheet URL, map columns, confirm) —
  `SheetImportDialog.tsx`, `src/sheets.ts`; `GET /api/sheet-csv` (server-side CSV proxy,
  `server/csv.ts`). `server.ts:2010-2039`.
- **Server-side product-page scraper** for auto-filling a new part/request from a purchase URL —
  `POST /api/scrape-part`. `server.ts:2040+`.
- **Inventory activity log** — recorded to `logs` on every quantity/edit change; surfaced via
  `ActivityLogs.tsx`.

### Storage Boxes
- **Box registry** — color tag, label, shop-coordinate location, per-box stored-item view —
  `BoxManagement.tsx`; `GET/POST/DELETE /api/boxes`. `server.ts:859-887`.

### Purchase Requests
- **Submit / approve / reject / complete workflow**, with decision notes and signed-off-by —
  `PurchaseRequests.tsx`, `RequestDialog.tsx`; `GET/POST /api/requests`,
  `PATCH /api/requests/:id`, `PATCH /api/requests/:id/details`, `DELETE /api/requests/:id`.
  `server.ts:889-1011`.

### 3D Print Queue
- **Job submission** (model-file upload via `multer`, quantity, urgency, filament type/color,
  strength) — `PrintJobDialog.tsx`, `PrintQueue.tsx`; `POST /api/print/jobs` (`uploadModel`
  middleware). `server.ts:1054-1088`.
- **Printer fleet** (named printers, active flag, add/remove) — `GET/POST/DELETE /api/printers`.
  `server.ts:1013-1032`.
- **Status lifecycle** queued→printing→done/failed/cancelled, per-job logs, file re-download —
  `PATCH /api/print/jobs/:id`, `POST /api/print/jobs/:id/complete`,
  `GET /api/print/jobs/:id/{logs,file}`, `DELETE /api/print/jobs/:id`. `server.ts:1045-1231`.

### Time Tracking & Attendance
- **Clock in/out with a single-open-session invariant**, optional backdated clock-in (capped at
  18h) — `TimeTracking.tsx`; `POST /api/time/clock-in`, `POST /api/time/clock-out`.
  `server.ts:1436-1481`.
- **Calendar-anchored meetings** pulled from a Google Calendar ICS feed (`node-ical`), with a
  mentor `endOverride` correction — `server/calendar.ts`; `GET /api/meetings`,
  `GET /api/meetings/active`, `PATCH /api/meetings/:id`. `server.ts:1612-1636`.
- **Midnight auto-close of forgotten clock-outs, backdated to the meeting's end time** —
  `sweepForgottenClockOuts()` runs at startup and every 10 minutes, closes any `time_entries` row
  still open from a prior day, setting `endAt`/`minutes` from `latestMeetingEndOnDay` and
  `updatedBy = 'auto (midnight)'`. `server.ts:2305-2337`, `server/calendar.ts`
  (`effectiveEnd`, `latestMeetingEndOnDay`, `localDay`).
- **Manual "Log Hours"** for offsite work, `pending` until a mentor confirms; in-meeting clock-ins
  default to `confirmed`, out-of-meeting ones to `pending` — `server.ts:1424,1467-1481,1523`
  (mentor review via `PATCH /api/time/entries/:id`).
- **Per-member/team totals, entries, open-session view** —
  `GET /api/time/{totals,entries,open,mine}`. `server.ts:1409-1435,1597-1611`.
- **Attendance calendar / report** per meeting — `AttendanceCalendar.tsx`;
  `GET /api/meetings/:id/attendance`, `GET /api/attendance/{calendar,report}`.
  `server.ts:1637-1731`.
- **Out-of-office / absence marking** per meeting day — `TimeOff.tsx`;
  `POST/DELETE /api/absences[/:day]`. `server.ts:1732-1763`.

### Task Board & Gantt
- **Multiple named boards** (create/rename/delete) — `TaskBoard.tsx`;
  `GET/POST/PATCH/DELETE /api/boards[/:id]`. `server.ts:1826-1889`.
- **Kanban columns** (todo/in-progress/done) with cards (title, description, assignee, date range,
  dependencies) — `TaskCardDialog.tsx`; `GET/POST/PATCH/DELETE /api/tasks[?boardId=]`.
  `server.ts:1890-2009`.
- **Dependency-driven auto-scheduling**: a task "blocked by" predecessors starts the day after the
  latest predecessor ends and runs `durationDays`, so moving a predecessor slides its dependents —
  `scheduleTasks()`, `src/scheduling.ts`.
- **Gantt chart** rendering the resolved schedule — `GanttChart.tsx`.

### People
- **Member roster** (name, role, subteam, grad year, email, ID/PIN) CRUD — `MemberManager.tsx`;
  `GET/POST/PATCH/DELETE /api/members[/:id]`. `server.ts:1232-1337`.
- **Subteams CRUD** — `GET/POST/DELETE /api/subteams[/:id]`. `server.ts:1338-1368`.
- **Mentor check-ins** (date-only, mentor-visible) — `MentorCheckins.tsx`;
  `GET/POST/DELETE /api/checkins[/:id]`. `server.ts:1369-1408`.
- **External-app access requests** (ask/grant/deny, doesn't provision real access) —
  `AccessRequests.tsx`; `GET/POST/PATCH/DELETE /api/access-requests[/:id]`.
  `server.ts:1765-1825`.

### Suggestion box & change log
- **Suggestion box** (category, message, optional name; mentor review) — `SuggestionDialog.tsx`,
  `SuggestionsAdmin.tsx`; `POST /api/suggestions`, `GET /api/suggestions`,
  `PATCH/DELETE /api/suggestions/:id`. `server.ts:301-396`.
- **"What's New" changelog**, superadmin-authored, everyone reads — `WhatsNew.tsx`;
  `GET/POST/PATCH/DELETE /api/changelog[/:id]`. `server.ts:397-527`.

### Admin / system
- **Audit trail**, role-filtered (leads see student/lead/system entries, mentors see all) —
  `ActivityLogs.tsx`; `GET /api/audit?limit=300`. `server.ts:146-173`.
- **Archive / pending-deletion review** (confirm or restore) — `ArchiveReview.tsx`;
  `GET /api/archived`, `POST /api/archived/:table/:id/{confirm,restore}`. `server.ts:174-257`.
- **Personal notification preferences** — `NotificationSettings.tsx`;
  `GET/PUT /api/me/notifications`. `server.ts:258-300`.
- **Site settings** (Drive link, kickoff date, etc.) — `SiteSettings.tsx`;
  `GET/PUT /api/settings/site`. `server.ts:426-462`.
- **Team documents viewer** (markdown pulled from a GitHub repo) — `Documents.tsx`, `server/docs.ts`;
  `GET /api/docs`, `GET /api/docs/file`. `server.ts:463-472`.
- **Dark/light theme picker**, persisted client-side only — `ThemePicker.tsx`, `src/theme.ts`.

## Integrations

- **Google Calendar (ICS polling)** — `node-ical` fetches the team calendar feed and drives
  meeting-anchored attendance and the midnight-sweep backdating. `server/calendar.ts`.
- **Google Identity Services (mentor sign-in)** — ID token verified server-side with `jose`;
  admission gated by a DB-backed mentor-email allowlist plus a `.env` superadmin allowlist.
  `server.ts:709-770`, `server/auth.ts`.
- **Google Sheets (inventory bootstrap import)** — link-shared sheet fetched server-side as CSV
  (`GET /api/sheet-csv`) and column-mapped client-side. `server/csv.ts`, `src/sheets.ts`.
- **Server-side part-page scraper** (`/api/scrape-part`) — fetches a purchase URL and extracts
  name/price/etc.; no LLM involved (matches the outside survey's inference). `server.ts`.
- **Nodemailer (SMTP outbound)** — notification emails for new suggestions, purchase requests,
  account approvals. `server/mailer.ts`.
- **GitHub-hosted markdown docs** — `server/docs.ts` fetches team documents from a GitHub repo for
  the in-app Documents viewer.
- **Cloudflare Tunnel + Caddy** — production ingress in front of the Express process; no public
  cloud hosting. `DEPLOY.md`.

## Notable Implementation Details

- **Single source of truth for access control.** `src/permissions.ts` is imported by both
  `server/acl.ts` (Express middleware) and `src/acl.ts` (UI gating) — one map of action → minimum
  rank, rather than scattered `requireRole` calls. `docs/PERMISSIONS.md` documents the checklist
  for adding a new gated action, including a required row in `tests/api.test.ts`'s auth-gating
  matrix.
- **ID numbers are never stored raw.** Both student ID lookups and the underlying login use an
  HMAC-SHA256 keyed hash (`hashLookup`, keyed by the session-signing secret) so the DB holds no
  PII school ID even though it needs an equality-indexable lookup. `server/auth.ts:103-107`.
  Mentor PINs are separately hashed (`server/pin.ts`).
- **Midnight-sweep design worth copying (praised in the Phase-1 outside survey; still true here):**
  single open time-tracking session per member; meeting-anchored attendance from a live Google
  Calendar feed; the interval sweep (on startup + every 10 minutes) closes any session left open
  from a prior calendar day and backdates its end to that day's actual meeting end
  (`latestMeetingEndOnDay`) rather than to "now" — so a forgotten clock-out doesn't inflate hours
  by accruing overnight. In-meeting clock-ins are trusted by default; only manual/out-of-meeting
  entries need mentor confirmation. `server.ts:2305-2337`, `server/calendar.ts`.
- **Dependency-driven Gantt auto-scheduling** is a small pure function
  (`scheduleTasks`, `src/scheduling.ts`) — a task with a `dependsOn` chain derives its start/end
  from its predecessors' resolved schedule plus its own `durationDays`, with cycle-safe recursion
  (`visiting` set) rather than a scheduling library.
- **No license file; `"private": true`.** All rights reserved by default — a re-implementer must
  treat every detail here as "recreate the behavior," never "copy the code."
- **No foreign-key constraints anywhere** — `server/db.ts` is plain SQLite tables with app-level
  ID references only (same integrity posture as cheesy-parts' Sequel models, but every ID here is
  a random string, not an auto-increment int).
- **Deploy gate lives in `CLAUDE.md`, not CI.** There is no GitHub Actions workflow; `npm run
  build && npm test` is documented as a required local gate before `deploy.sh` runs, enforced by
  convention/agent discipline rather than a pipeline.
- **Guest-mode strictness has apparently changed since the Phase-1 outside survey.** The current
  permission map (`src/permissions.ts`) requires at least `student` rank for every listed action,
  including `inventory.view`/`boxes.view` — meaning a true no-session guest gets 401 everywhere in
  this commit, not just on sensitive endpoints like `/api/audit`. The outside survey observed
  live, unauthenticated read-only browsing of inventory/boxes/etc. This may reflect the deployed
  instance running a different configuration or an earlier/later version than this commit; the
  underlying mechanism (a real server-enforced session-based gate, not client-side hiding) matches
  in both cases.
- **Deployment subdomain mismatch.** The repo's own docs reference `inventory.tigerdynasty.app`
  (`.env.example`) and `inventory.kyleheaton.xyz` (`DEPLOY.md`), not `den.tigerdynasty.app` — team
  identity and every functional fingerprint match, so this looks like a subdomain rename over
  time rather than a different app.

**Last activity / maintenance status:** HEAD commit dated 2026-08-21 (one day before this survey)
— actively maintained. `CLAUDE.md` describes a live, in-use deploy workflow (`/deploy` skill,
build+test gate, systemd service) rather than an abandoned prototype.
