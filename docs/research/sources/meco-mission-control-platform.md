# MECO Mission Control Platform — Source Survey

**Repo:** meco-robotics/meco-mission-control-platform — https://github.com/meco-robotics/meco-mission-control-platform
**Surveyed-at:** e5154b2877bb550efe46844282f71599a208b1c1
**Permalink form:** https://github.com/meco-robotics/meco-mission-control-platform/blob/e5154b2877bb550efe46844282f71599a208b1c1/<path>
**Stack:** TypeScript, Fastify 5 API, Prisma 6 ORM over PostgreSQL, Zod validation, JWT (jsonwebtoken) sessions, google-auth-library for Google SSO, nodemailer for email codes, @aws-sdk/client-s3 for presigned uploads, Docker Compose for a self-hosted VPS deployment
**License:** none found — no `LICENSE` file, no license field in `package.json`. All rights reserved; ideas only.
**Last activity:** 2026-08-12 (pushed_at; latest commit 2026-08-11)
**FRC team:** MECO Robotics (`mecorobotics.org` hosted domain, referenced throughout auth config and docs)
**Areas:** (1) time/attendance, (2) people/rosters, (3) third-party integrations (Slack, Onshape, Google, S3), (5) parts ordering/POs, (6) part design/manufacturing tracking

## Purpose

A backend-only API platform ("Mission Control") for an FRC team's build-season operations: task/requirement planning tied to subsystems and mechanisms, meeting attendance and RSVPs, manufacturing and purchasing request tracking with mentor QA gating, and a CAD pipeline that imports both raw STEP files and live Onshape documents into a normalized, snapshot-based assembly/part/BOM model for mapping into the team's own subsystem/mechanism/part hierarchy.

## Auth & Roles

- Google Identity Services SSO (`POST /api/auth/google`): server verifies the Google ID token against `GOOGLE_CLIENT_ID` and enforces `GOOGLE_ALLOWED_HOSTED_DOMAIN`, then issues its own signed JWT (`AUTH_JWT_SECRET`, `AUTH_TOKEN_TTL`). `src/auth/authService.ts`.
- Email one-time-code fallback (`POST /api/auth/email/start` / `/verify`) via SMTP or Resend, with per-address cooldown, code TTL, and max-attempt cap; codes are stored in memory only (cleared on restart).
- Mobile device sessions get a longer-lived token (`AUTH_DEVICE_TOKEN_TTL`, default 3650d) keyed by a per-install device ID.
- Roles: `STUDENT` / `MENTOR` / `ADMIN` (Prisma `MemberRole` enum). Mentor emails are configured via `AUTH_MENTOR_EMAILS`; anyone else on the hosted domain defaults to student.
- Subteam assignment (`programming`, `mechanical`, `electrical`, `media-marketing`, `business`, `scouting`) is configured via `AUTH_MEMBER_SUBTEAMS_BY_EMAIL` and can be updated live through `PATCH /api/users/me/preferences`, which writes the change back into the env file so web/mobile share the mapping.
- Dev-only `POST /api/auth/dev-bypass` issues a student or mentor session with no credentials; the route is not registered in production builds.
- Onshape OAuth credential management and deep-release CAD sync are restricted to `lead`/`mentor`/`admin` roles (`docs/onshape-integration.md`).
- Production refuses to start unless auth is fully configured and `CORS_ORIGIN` is an explicit allowlist (no wildcard).

## Data Model

Prisma schema (`prisma/schema.prisma`), PostgreSQL:

- **People/roster:** `Member` (role, planned weekly attendance hours/days), `Subsystem` (self-referential parent/child tree, responsible engineer, core flag), `Mechanism`, `SubsystemMember`/`SubsystemMentor` join tables, `Discipline` (mechanical/electrical/software/integration/QA-test).
- **Planning:** `Requirement` (MoSCoW priority), `Task` (status/priority, owner+mentor+assignees, parent/iteration self-relation, links to subsystem/discipline/requirement/mechanism/part instance/milestone), `TaskDependency`, `TaskBlocker`, `Milestone` (practice/competition/deadline/review/demo), `WorkLog` + `WorkLogParticipant`, `Risk` + `RiskTask`.
- **Attendance:** `Meeting`, `RSVP` (yes/maybe/no), `AttendanceRecord` (sign-in/out, computed hours).
- **Parts/manufacturing/purchasing:** `PartDefinition` (part number, revision, season), `PartInstance` (quantity, per-instance tracking flag, status), `ManufacturingBatch`, `ManufacturingItem` (process: 3D print/CNC/fabrication; status; mentor-reviewed flag), `PurchaseItem` (vendor, cost, approval/purchase/delivery timestamps), `TaskManufacturingItem`/`TaskPurchaseItem` join tables, `QAReview` + `QAParticipant` (pass/minor-fix/iteration-worthy result, mentor approval gate) shared between tasks and manufacturing items.
- **CAD/Onshape (large, dedicated sub-schema):** `OnshapeConnection`, `OnshapeDocumentRef` (parsed document/workspace/version/microversion/element IDs), `CadImportRun` (source: STEP upload / Onshape API / BOM CSV; status pipeline; call budget usage), `OnshapeApiRequestLog`, `OnshapeApiCacheEntry` (immutable vs TTL caching), `CadSnapshot` (historical, immutable, chained via `previousSnapshotId`), `CadAssemblyNode` (tree with inferred type: subsystem/mechanism/component-assembly candidate), `CadPartDefinition`, `CadPartInstance`, `CadMappingRule` (reusable match strategy → target kind, supersession chain), `CadSnapshotMapping` (per-snapshot proposal/confirm/reject), `CadImportWarning`, `OnshapeApiBudget` (daily/monthly/annual call budgets with warning/hard-stop thresholds).

## Features

**Part design / manufacturing tracking (primary area, most developed):**
- STEP file upload and parsing pipeline: lightweight ISO-10303-21 text parser (no geometry) turning a STEP assembly graph into normalized assembly nodes/part definitions/instances — `src/cad/parsing/stepTextParser.ts`, `stepTextEntityParser.ts`, `stepParserClient.ts`, `src/cad/cadImportService.ts`.
- Snapshot-based CAD history: every import creates an immutable `CadSnapshot`; new uploads diff against the previous snapshot instead of mutating it — `src/cad/cadDiffService.ts`.
- Hierarchy review and validation before finalizing a snapshot (detects flattened/generic-named assemblies, requires manual review) — `src/cad/cadHierarchyReviewService.ts`, `cadHierarchyValidationService.ts`, `cadHierarchyApplyService.ts`.
- Mapping-rule engine that turns CAD assembly nodes/parts into team subsystem/mechanism/component-assembly/part-definition targets, with match strategies (stable signature, instance path, normalized name ± parent) and confidence levels, plus rule supersession — `src/cad/cadMappingEngine.ts`, `src/cad/routes/cadMappingRuleRoutes.ts`.
- Part-instance matching between imported CAD parts and existing platform `PartDefinition`s — `src/cad/cadPartMatchingService.ts`.
- Live Onshape integration as a parallel/future-converging pipeline: OAuth2 (no API keys), document-URL parsing/linking without spending API calls, tiered sync levels (`link_only`/`shallow`/`bom`/`deep_release`), per-request caching (immutable for versions/microversions, short TTL for workspaces) and API-call budget enforcement with soft/hard thresholds — `src/onshape/onshapeOAuth.ts`, `onshapeCadClient.ts`, `onshapeSyncPolicy.ts`, `onshapeUrlParser.ts`, `bom/normalizer.ts`, `bom/bomTable.ts`, `bom/rootAssembly.ts`.
- BOM import: assembly nodes, part definitions/instances, quantities, and metadata pulled from Onshape's bulk BOM/assembly data — `src/onshape/cadImporter.ts` (large, central importer), `cadImporterWarnings.ts`.
- Manufacturing item request/QA workflow: batches, process type (3D print/CNC/fab), mentor-review flag, linkage to tasks and part definitions — Prisma `ManufacturingItem`/`ManufacturingBatch`, `src/routes/registerRoutes.ts`.
- Full audit trail of Onshape API usage (`OnshapeApiRequestLog`) and cache entries for debugging/cost control.

**Parts ordering / POs:**
- `PurchaseItem` lifecycle: requested → approved → purchased → shipped → delivered, with vendor, link, estimated vs final cost, requester/approver members, and linkage to tasks and part definitions.

**Time/attendance:**
- Meetings with RSVP (yes/maybe/no) and sign-in/sign-out attendance records producing computed total hours — `src/data/store/meetingSchedule.ts`, `src/routes/meetingRoutes.ts`.
- Member-level planned weekly attendance hours/days/notes used for roster insight reporting — `src/routes/helpers/rosterInsights.ts`, `rosterInsightsMemberMetrics.ts`.

**People/rosters:**
- Member roster with role, subteam assignment (env-driven, live-updatable), subsystem membership/mentorship join tables, responsible-engineer assignment per subsystem.

**Third-party integrations / communication:**
- Slack "home" service: per-member alert/summary/todo/meeting-recap view assembled from configured channel IDs and usergroup handles — `src/slack/homeService.ts`, `src/slack/client.ts`.
- S3-compatible presigned media upload for tasks/QA evidence — `src/storage/mediaUploadService.ts`.

**Cross-cutting / task-management core:**
- Task completion gating: documentation-evidence requirement, mentor QA approval, task dependency graph, blockers (task dependency/manufacturing delay/shipping delay/QA feedback/other) — `src/domain/workflows.ts`, `src/domain/taskDependencyState.ts`.
- Milestones (practice/competition/deadline/internal-review/demo) with readiness status and linked subsystems/projects.
- Risk register linked to subsystems and tasks with severity levels.

## Integrations

- **Onshape** — OAuth2, document linking, tiered sync (link-only/shallow/BOM/deep-release), BOM import, API budget/caching (see above; this is the module the survey was specifically scoped for).
- **Google** — SSO via Google Identity Services (`google-auth-library`), hosted-domain restricted.
- **Slack** — bot token + per-channel/usergroup env config for a "home" feed of alerts/summaries/recaps (`src/slack/`); no evidence of bidirectional bot commands, just outbound content assembly.
- **Email/SMTP** — nodemailer, with a Resend-specific fallback path when only `RESEND_API_KEY` is set; local dev SMTP sink (`npm run smtp:dev`).
- **S3-compatible object storage** — presigned upload/download for media (`@aws-sdk/client-s3`).

## Notable Implementation Details

- Deliberately backend-only repo — no frontend code lives here; it's the API for separate web/mobile clients.
- Two parallel CAD ingestion paths exist by design: a generic STEP-upload pipeline (Prisma-backed via `CAD_STORE_DRIVER=prisma`, runtime-store fallback for tests) and an Onshape-specific MVP path that currently stores its own runtime data rather than routing through the generic CAD Prisma store — the docs explicitly flag this as a known gap to converge later (`docs/onshape-integration.md` "Known Limitations").
- STEP parser has an explicit `placeholder` mode that returns visibly fake data (`PLACEHOLDER PARSER RESULT - NOT REAL CAD`) for tests/demos only; production startup refuses to boot with that mode — a good anti-footgun pattern worth copying for any fixture/demo parser.
- CAD snapshots are immutable history; mapping decisions are layered on top via reusable, supersedable `CadMappingRule` records plus one-off `CadSnapshotMapping` proposals, so re-imports don't silently rewrite past evidence — a clean model for any repeated-import/repeated-BOM-sync tool.
- Onshape API cost control is a first-class concern: per-call request logs, immutable vs short-TTL caching, and a budget entity with daily/monthly/annual counters and warning/hard-stop percentages tuned for Onshape's Education plan rate limits — directly reusable pattern for any team building against Onshape's metered API.
- Repo ships its own internal Claude Code skills (`skills/frc-domain`, `skills/app-architecture`, `skills/api-review`, etc.) and an `AGENTS.md` — suggests active AI-assisted development workflow, not directly a feature to copy but shows a mature, well-documented codebase.
- Deployment targets a single self-managed Ubuntu VPS (Hetzner/DigitalOcean/Vultr) via Docker Compose + GitHub Actions SSH deploy, explicitly moving away from PaaS — the app container runs `prisma db push` on startup.
- Request hardening: 64 KB JSON body cap on most routes (2 MiB general Fastify limit, separate 250 MiB STEP-upload limit), per-IP rate limiting split across general API / auth / email-auth budgets, no-store cache headers, HSTS in production.

## Verdict

Substantive and directly on-scope: a real, actively developed FRC team-ops backend with the most detailed Onshape/STEP CAD-to-BOM-to-subsystem mapping pipeline seen in this survey set (immutable snapshots, supersedable mapping rules, API budget/caching for Onshape). No license file, so treat all of it as ideas-only — but the CAD snapshot/mapping-rule model, the Onshape budget/cache pattern, and the placeholder-parser production guard are all worth stealing conceptually.
