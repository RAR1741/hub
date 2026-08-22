# CTRC Dashboard — Source Survey

**Repo:** malharsoni/ctrc-dashboard — https://github.com/MalharSoni/ctrc-dashboard
**Surveyed-at:** 7aa6dc3dd5d35cc23f49b78aa5081c6b72b45f6e
**Permalink form:** https://github.com/MalharSoni/ctrc-dashboard/blob/7aa6dc3dd5d35cc23f49b78aa5081c6b72b45f6e/<path>
**Stack:** Static HTML/CSS/vanilla JS frontend (no framework/bundler) + Netlify serverless functions (Node) as the API layer + Prisma/PostgreSQL for the data model; Netlify Blobs for token storage; MSAL / Microsoft Graph client for Outlook OAuth. Deployed to Netlify.
**License:** none — no LICENSE file in the tree, `license` field on the GitHub API is null, README has no license section. Treat as all-rights-reserved; ideas only, do not copy code or verbatim schema/text.
**Last activity:** 2026-04-04 (pushed_at), actively maintained (many `*_COMPLETE.md`/`*_SUMMARY.md` progress-tracking docs at repo root suggest an iterative, single-developer build cadence).
**FRC team:** Not FRC — this is **Caution Tape Robotics Club**, a VEX team (schema comment: `teamNumber String? // VEX team number`, `TeamRole` enum has SCOUT/NOTEBOOK, `CurriculumCategory` includes CAD_DESIGN/NOTEBOOK). Labeled here as a **VEX-comparable** tool since VEX and FRC team-ops needs overlap closely.
**Areas:** people/rosters (primary — students, teams, curriculum/skills tracking), time/attendance (Saturday-session attendance + daily performance ratings), parts ordering/POs (inventory + Outlook-sourced invoice tracking), third-party integrations (Microsoft Outlook/Graph). No dedicated communication (mass email/SMS) or manufacturing/part-design-tracking features found.

## Purpose
A single-club (not multi-team SaaS despite the `User`/`CoachProfile` scaffolding) operations dashboard for a VEX club coach: track a full student roster with team assignments and skill/curriculum progress, run Saturday attendance + daily performance logging, manage a task board, track parts inventory and vendor invoices (auto-synced from an Outlook inbox), and generate parent-facing report cards/exports.

## Auth & Roles
Prisma schema defines a full NextAuth-style auth model (`User`, `Account`, `Session`) with `UserRole` enum (`ADMIN`, `COACH`) and a `CoachRole` enum on the `TeamCoach` join table (`HEAD_COACH`, `ASSISTANT`, `OBSERVER` — read-only). However, the live frontend (static HTML pages) shows no visible login/session-gating code in the sampled JS — the API functions (`netlify/functions/api.js`) appear to be called directly without auth headers in `js/api-client.js`. This reads as a schema built for multi-coach/multi-team use that the shipped frontend doesn't yet enforce; treat the role model as "designed but not wired up" rather than a working permission system.

## Data Model
Prisma schema (`prisma/schema.prisma`, 854 lines) — key entities:
- **Auth/org:** `User` → `CoachProfile` (1:1) → `Team` (via `TeamCoach` m:m with `CoachRole`); `Season` (current-season flag) linked to `Team`.
- **People/rosters:** `Student` (grade, gradYear, parent contact fields, bio/avatar) ↔ `Team` via `TeamMember` (primary + secondary `TeamRole` enum: CAPTAIN/DRIVER/PROGRAMMER/BUILDER/DESIGNER/SCOUT/NOTEBOOK/MEMBER; tracks `leftAt` for roster history).
- **Curriculum/skills:** `CurriculumModule` (nestable via `parentId` self-relation) → `CurriculumLesson` (with quiz data) → `CurriculumProgress` per student (status, quizScore, evidence photo link into `ProjectMedia`); separate `Skill`/`StudentSkill` m:m with proficiency + verification + evidence URL.
- **Tasks:** `Task` (priority/status/category enums, due dates) → `TaskAssignment` per student, `TaskAttachment`.
- **Projects:** `Project` → `ProjectRole` (per-student role + hoursSpent) and `ProjectMedia` (image/video/doc/link).
- **Attendance/daily ops:** `AttendanceRecord` (PRESENT/ABSENT/EXCUSED per student per date), `DailyPerformance` (1-5 rating per session), `XFactorNote` (280-char tagged coach observation, e.g. "Leadership", "Breakthrough").
- **Trials/pipeline:** `TrialStudent` (prospective member funnel: SCHEDULED→ATTENDED→CONVERTED/NO_SHOW/DECLINED, AM/PM time slot, `source` field tracks 'outlook'/'manual'/'website', converts into a real `Student`).
- **Reporting/export:** `ReportCard` (period-based, 6 rating dimensions, narrative fields, `exportToken` for secure sharing) and generic `ExportToken` model (entity-type + expiry + max-access + optional password) for shareable read-only links to report cards/profiles/team summaries.
- **Audit:** `AuditLog` (userId, action, entityType/Id, JSON before/after diff).
- Inventory/purchases/invoices are NOT in the Prisma schema — they live only in the static HTML pages and Netlify Blobs (see below), suggesting a schema migration in progress (partial move from a JSON/localStorage-era app to Postgres).

## Features
**People/rosters**
- Full student CRUD with grade, parent contact, avatar, bio (`prisma/schema.prisma` `Student` model; `netlify/functions/api.js` `/students` GET/POST; `js/students-validation.js`)
- Bulk team assignment endpoint (`netlify/functions/api.js:326` `/students/bulk-assign`)
- Per-student profile page with dynamic API-loaded data: tasks, skills (proficiency %), curriculum progress, avatar color hashing (`student-profile.html`, `js/student-profile.js`, `student-profile-dynamic.js`)
- Global command-palette search (⌘K) across students/teams/pages (`js/global-search.js`, `search-modal.html`)
- Team roster management with 8-role tagging system (Captain/Driver/Programmer/Builder/Designer/Scout/Notebook/Member) and secondary roles (`prisma/schema.prisma` `TeamRole`; `teams.html`, `team-detail.html`, `js/teams-validation.js`)
- Skill tracking with coach verification and evidence links, separate from curriculum (`Skill`/`StudentSkill` models)
- 8-week "Foundation" onboarding curriculum tracker: per-student pacing, color-coded week badges, 8-segment progress bars, expandable rows with weekly scores/notes/photos, PDF parent-report export (README "Foundation Page Features"; `foundation.html`, `js/foundation-validation.js`)
- Trial/prospective-student pipeline with AM/PM slot scheduling and conversion-to-student flow (`prisma/schema.prisma` `TrialStudent`; `trials.html`; `netlify/functions/api.js:607,634` `/trials`)
- Report cards: 6-axis rating (technical, teamwork, leadership, communication, problem-solving, initiative), narrative fields, publish flag, secure export token for parent sharing (`ReportCard`/`ExportToken` models; `reports.html`)

**Time/attendance**
- Saturday-session attendance (PRESENT/ABSENT/EXCUSED) with per-date uniqueness and stats rollup (`netlify/functions/api.js:357,405,446,530` `/attendance`, `/attendance/session`, `/attendance/stats`; `ATTENDANCE_FEATURE.md`, `ATTENDANCE_IMPLEMENTATION_COMPLETE.md`)
- Daily 1-5 performance rating per student per session, separate from attendance status (`DailyPerformance` model)
- "X-Factor" quick-tag coach notes (280 char, tags like Leadership/Breakthrough) for capturing qualitative moments during sessions (`XFactorNote` model)

**Parts ordering/POs**
- Parts inventory with low-stock alerts (`inventory.html`, `js/inventory-validation.js`, README)
- Purchases/invoice tracking pages, including a dedicated invoices view (`purchases.html`, `purchases-invoices.html`)
- Automated invoice ingestion from a connected Outlook mailbox: keyword-filters emails for invoice/receipt/order-confirmation language, regex-extracts invoice number/amount/date, and vendor-detects against a hardcoded keyword map for VEX Robotics, AndyMark, West Coast Products, REV Robotics, and McMaster-Carr (`netlify/functions/invoices-sync.js`, `docs/INVOICE_INTEGRATION.md`)
- Mark-invoice-paid endpoint (`netlify/functions/invoice-mark-paid.js`)

**Third-party integrations**
- Microsoft Outlook OAuth (MSAL confidential-client flow) storing access/refresh tokens + expiry in Netlify Blobs, scoped to `Mail.Read`/`Mail.ReadBasic` (`netlify/functions/outlook-auth.js`, `docs/OUTLOOK_SETUP.md`, `OUTLOOK_QUICK_REFERENCE.md`)

**Tasks/projects**
- Task board with priority/status/category enums, team- or individual-assignment modes, due dates, attachments (`Task`/`TaskAssignment`/`TaskAttachment`; `tasks.html`, `js/tasks-validation.js`)
- Project tracking with per-student roles, hours logged, goals/outcomes, and media gallery (photos/videos/docs/links) that can double as curriculum-progress evidence (`Project`/`ProjectRole`/`ProjectMedia`)

## Integrations
Microsoft Outlook / Microsoft Graph (OAuth via MSAL, invoice email parsing). No Slack/Discord/TBA/Onshape/SMS integration found in the tree.

## Notable Implementation Details
- The project is mid-migration: a Prisma/Postgres schema exists alongside dozens of `.html.backup`/`.bak` files and root-level markdown logs (`MIGRATION_GUIDE.md`, `MIGRATION_STATUS.md`, `FINAL_MIGRATION_COMPLETE.md`) documenting a move away from an earlier localStorage/JSON version — `js/api-client.js` comment literally says "Centralized API layer replacing localStorage." A re-implementer should design straight for the target relational schema rather than replicate the migration path.
- Inventory/purchases/invoices are NOT represented in the Prisma schema at all — they're handled through Netlify Blobs and ad-hoc JSON in the serverless functions, so the "real" data model for parts ordering lives in code, not in `schema.prisma`. Don't assume schema.prisma is the complete picture for that area.
- The Outlook invoice parser is a pragmatic but fragile pattern worth studying, not copying: regex-based amount/invoice-number extraction from email body text and a hardcoded vendor-keyword map (5 vendors) — this only works for vendors whose emails are added to the list, and dollar-amount regex extraction from free text is inherently lossy (first-match, no currency/line-item disambiguation).
- Full auth schema (User/Account/Session/roles) exists but the frontend calls the API directly with no visible auth header/session check — worth confirming before assuming role-based access actually gates anything in production.
- Report cards and student/team profiles support shareable, expiring, optionally-password-protected export links (`ExportToken` model) — a clean pattern for parent-facing sharing without giving parents dashboard accounts.
- `AuditLog` model (generic action/entityType/entityId/JSON diff) is a reasonable lightweight audit-trail pattern if compliance/traceability is ever needed.
- Frontend is plain HTML/CSS/JS with no build step (`python3 -m http.server` for local dev, `netlify.toml`+`deploy.sh` for prod) — very low operational overhead but no component reuse or type safety across ~20 near-duplicate HTML pages.

## Verdict
Substantive and directly relevant — the richest people/rosters + attendance + curriculum-tracking data model seen in this batch (8-week onboarding tracker, skills/curriculum progress, X-Factor notes, report cards with export tokens), plus a concrete, working pattern for auto-pulling vendor invoices out of an Outlook inbox for parts-order tracking. No license file means ideas-only: worth stealing are the `ExportToken` share-link pattern, the report-card rating structure, the Foundation/onboarding progress tracker concept, and the invoice-email-parsing approach (reimplemented, not copied).
