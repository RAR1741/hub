# Tiger Den (den.tigerdynasty.app) — Web Survey

**Site:** https://den.tigerdynasty.app/ (FRC Team 5010 "Tiger Dynasty", Fishers HS, Fishers IN)
**Surveyed:** 2026-08-10, via live guest-mode browsing, API responses, and JS-bundle string mining (`/assets/index-C-pgBf8a.js`). Plain fetches return 403 (Cloudflare); observations were made through the app itself.
**Source availability: closed-source.** No public repo found: the team's GitHub orgs (FRC5010, 5010TigerDynasty) hold only robot code; GitHub repo/code search for the domain returns zero results; Chief Delphi has no posts about it. Treat all features as observed behavior only — there are no code references for this source.

## Purpose

Tiger Den is the internal team-management SPA of FRC 5010: shop **inventory management**, **storage box organization**, a **3D print queue**, **time tracking / meeting attendance**, **task boards with Gantt charts**, and (behind login) **purchase requests, audit logs, and admin tooling**. The root URL opens straight into a guest "View-Only Access Mode" — it's a private tool, not a product.

## Stack (as determinable from outside)

- **Frontend:** React SPA built with Vite (single hashed bundle, ~550 KB, no code splitting, no client-side URL routing — "pages" are React state), Tailwind CSS with dark mode.
- **Backend:** Node/Express (`x-powered-by: Express`) serving a same-origin JSON REST API under `/api/*`, reverse-proxied by Caddy, fronted by Cloudflare.
- **Auth:** Google Identity Services for mentor OAuth; students sign in with a team ID number; mentors alternatively ID + PIN; cookie sessions. Guest mode is a real server-side session with per-endpoint role gates (e.g. `/api/audit` returns 401 for guests).
- **Integrations:** Google Calendar (meetings), Google Sheets (inventory bootstrap import), a server-side URL scraper for part metadata (`/api/scrape-part`, explicitly no-LLM).
- **Database / hosting:** unknown. Prefixed random IDs (`board_9ed279…`, `req_bygu0o6a`) suggest a document store or SQLite rather than auto-increment SQL (inference).

## Features

Legend: [App] = observed live in guest mode; [API] = JSON responses; [Bundle] = strings in the JS bundle. Items marked *inference* are extrapolated.

### Authentication, roles, access
- Guest/read-only mode with "Reset Guest Session"; full browsing without login. [App]
- Sign-in modal: students by ID number; mentors by Google (preferred) or ID + PIN. [App]
- Student self-service account requests (`/api/auth/request-account`). [App][Bundle]
- Roles: `admin`, `mentor`, `lead`, `student`, `guest`; plus server-configured superadmins and an "Admin Mode". [Bundle]
- Mentor allowlist: Google accounts allowed to sign in as mentor (`/api/settings/mentor-emails`). [Bundle]

### Shop Inventory
- Parts catalog: name, supplier, box label/location coordinate/tag color, stock qty vs "Min Stock Warning Point", unit price, per-row detail/edit. [App]
- Search across name/box/location/supplier; filter by box tag color (8 colors), stock status (Fully Stocked / Low Stock / Out of Stock), coordinates; column sorting. [App]
- Low-stock badge in sidebar ("6 low"); per-section item counts. [App]
- Add-item flow with SKU/part number, specs, last-purchased date; "Estimated Inventory Value" rollup. [Bundle]

### Storage Boxes
- Registry of 112 physical boxes: custom label, color-coded tag stripe, exact shop coordinate (e.g. `B13`). [App]
- Per-box part count, "View Stored Inventory" expansion, sorts, create/quick-add/edit, duplicate-label prevention. [App][Bundle]

### Google Sheets import
- "Bootstrap from Google Sheets": paste a sheet URL, map spreadsheet columns to inventory properties, confirm import (first tab only). [Bundle]

### Purchase Requests (login-gated)
- Request records: item, quantity, unit price, supplier, purchase URL, notes, SKU, requested-by/at. [API `/api/requests`]
- Status workflow: `pending` → `approved`/`rejected` → `completed`, with decision notes, timestamps, signed-off-by. [API][Bundle]
- Auto-fill from URL via server-side scraper (`/api/scrape-part`). [Bundle]
- Reorder/restock request prefilled from an existing request or inventory item. [Bundle]
- Import an approved/purchased request into the inventory database. [Bundle]
- Search, open vs pending-review groupings, "Purchase Requests & Quotes", "Request budget for parts list". [Bundle]

### 3D Print Queue
- Job submission (login required): model file upload (100 MB cap, `.3mf` observed), quantity, urgency (floats to top), filament type (PLA/PETG/Nylon) and color, estimated print time. [App][Bundle]
- Printer fleet: named printers with notes and active flag ("Hobbes (A1 Mini)", "Rajah (Bambu X1C)", …); add/remove; assign a printer to a job. [API `/api/printers`]
- Status lifecycle: Queued / Printing / Done / Failed / Cancelled with Start/Finish actions and filtering. [App]
- Per-job activity trail (submitter, completer, timestamps), file download, collapsible completed archive. [App]

### Time Tracking & Attendance
- Clock in/out with live timer; **single open session invariant**. [App]
- Meetings pulled from the team Google Calendar; clocking in during a meeting auto-attaches the session for attendance counting; per-meeting attendance view. [App]
- Forgot-to-clock-out: at midnight on a meeting day, open sessions auto-close **backdated to the meeting's end time**. [App]
- Manual "Log Hours" for offsite work — pending until a mentor verifies; out-of-meeting clock-ins also flagged for review. Only confirmed hours count. [App][Bundle]
- Totals per subteam, team leaderboard, recent entries, live "In the shop" presence list. [App]
- Endpoints: `/api/time/{clock-in,clock-out,entries,manual,mine,open,totals}`, `/api/meetings`. [Bundle]

### Task Board (kanban) & Gantt
- Multiple named boards (create/rename/delete). [App]
- Columns To Do / In Progress / Done with drag-and-drop. [App]
- Cards: title, description, assignee, start–end date range. [App]
- Dependencies with auto-scheduling: "Blocked by:", "Starts automatically the day after the task(s) above finish". [Bundle]
- Per-board Gantt timeline: task bars on a date axis, status color legend, "Unscheduled" bucket, today marker. [App]

### Suggestion Box
- Public "Suggest an idea or report a bug" dialog with per-module category dropdown, optional name, 2000-char text; mentors review on the System page. [App][Bundle]

### Audit Logs
- "Workspace Audit Trail" (`/api/audit?limit=300`), role-gated (401 for guests). [API]

### Admin / System (from bundle + endpoints)
- Members management (`/api/members`): role, subteam, grad year, email, ID number, mentor PIN. [Bundle]
- Subteams CRUD (`/api/subteams`). [Bundle]
- Notifications (`/api/me/notifications`): new purchase request, new suggestion, part proposed. [Bundle]
- Archived records, pending deletions/approval queues, system logs, profiler. [Bundle]

### General UI
- Dark/light toggle, collapsible sidebar grouped Inventory / Fabrication / People / Planning, count badges, per-module refresh. [App]

## Notable Implementation Details

- **Full API surface** (bundle-extracted): `/api/auth/{config,google,id,logout,me,request-account}`, `/api/inventory[/:id]`, `/api/boxes[/:id]`, `/api/requests[/:id]`, `/api/scrape-part`, `/api/sheet-csv`, `/api/print/jobs[/:id]`, `/api/printers[/:id]`, `/api/boards[/:id]`, `/api/tasks[?boardId=]`, `/api/time/*`, `/api/meetings[/:id]`, `/api/members[/:id]`, `/api/subteams[/:id]`, `/api/suggestions[/:id]`, `/api/audit`, `/api/archived[/:id]`, `/api/me/notifications`, `/api/settings/mentor-emails`.
- **Time-tracking design choices worth copying:** single open session; meeting-anchored attendance from Google Calendar; midnight auto-close backdated to meeting end (prevents inflated hours); trust-by-default for in-meeting hours with mentor verification only for manual/out-of-meeting entries.
- **Guest mode is server-enforced**, not just UI hiding — a real downgraded session with per-endpoint gates.
- Actively used and developed (live Aug 2026 data, module-categorized suggestion box, seeded test rows still present).
