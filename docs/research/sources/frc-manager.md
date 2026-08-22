# FRC_Manager — Source Survey

**Repo:** https://github.com/tkruger/FRC_Manager
**Surveyed at commit:** `8ec18ab0e2092175f935bd13971fc7849c0c9237`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/tkruger/FRC_Manager/blob/8ec18ab0e2092175f935bd13971fc7849c0c9237/<path>`

## Purpose

FRC_Manager ("FRC Team Management Suite") is a single Next.js app covering **eight** operational
modules for an FRC team, not the six the README's one-line description names: Robot Fleet, Tool
Management, Parts/Materials Inventory, Procurement & Ordering, Budget Management, Build-Season
Schedule (incl. Gantt), Compliance & Safety, plus cross-cutting Auth/membership-approval and
Notifications. The README itself is still the unedited `create-next-app` boilerplate text — the
one real line of team-specific description ("$5k BOM compliance") undersells how much is actually
built. The repo is a **single squashed commit** (`8ec18ab`, dated 2026-05-17) with no other
history — there is no way to see incremental development, and no evidence this has been run by an
actual team across a season. A `.claude` directory is *not* present here (unlike frc-part-tracker),
but `AGENTS.md`/`CLAUDE.md` carry the same auto-generated "This is NOT the Next.js you know"
boilerplate Next.js's dev server injects for AI coding agents, and the codebase's uniform
Zod-validated-Server-Action style across ~2,200 lines of `src/app/actions/*.ts` is consistent with
AI-agent-assisted, single-session generation rather than hand-written iterative development.

**Verdict on the "how much is real" question:** the vast majority of it is real, working
server-side logic (Prisma queries, Zod validation, role checks, notification triggers) — not
placeholder pages. Every one of the eight modules has a populated Prisma schema section, a Server
Actions file with several real mutations, and at least one non-trivial page. The standout example
of "real, not just a label" is the BOM cost-cap module: it computes FIRST's actual $5,000 fair-
market-value robot cost limit (with KOP/First-Choice/under-$5 exemptions) live from a Robot's BOM
line items and exports a FIRST-formatted compliance CSV. What's thin: no automated tests exist
anywhere in the repo, there is no seed data/demo mode, and several UI affordances (e.g. a robot
switcher `<select>` using `window.location.href` instead of a proper client transition) show
first-pass rather than polished implementation.

## Stack

- **Language/Framework:** TypeScript, Next.js 16 (App Router), React 19. `package.json`.
- **Database/ORM:** PostgreSQL via Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`, `pg`), driver
  adapters (no `previewFeatures` flag needed in Prisma 7). One schema file,
  `prisma/schema.prisma` (~1,034 lines), one migration directory,
  `prisma/migrations/20260516162753_init/`.
- **Auth:** NextAuth v5 beta (`next-auth@^5.0.0-beta.31`) with `@auth/prisma-adapter`; credentials
  provider (bcryptjs-hashed passwords) plus an optional Google OAuth provider gated on env vars
  being present. `src/lib/auth.ts`, `src/lib/auth.config.ts`.
- **Validation:** Zod schemas inline in nearly every Server Action (`safeParse` + `flatten()` field
  errors) — genuinely used throughout, unlike frc-part-tracker where Zod is a dependency but
  unused.
- **UI:** Radix UI primitives (Dialog, Select, Tabs, Toast, Tooltip, Switch, Checkbox, etc.) +
  `class-variance-authority`/`tailwind-merge` for a small design-system layer under
  `src/components/ui/`; `react-hook-form` + `@hookform/resolvers` for client-side forms; Tailwind
  CSS v4 with CSS custom-property color tokens (`--color-primary`, `--color-danger`, etc.) driving
  a light/dark-aware theme (`displayMode` per user: `LIGHT|DARK|AUTO_SYSTEM|AUTO_TIME`).
- **License:** **Apache License 2.0** — `LICENSE` file present at repo root (the only one of the
  two surveyed repos with a real license).
- **Hosting:** no Dockerfile, no CI workflow; implicitly Vercel-shaped (Next.js conventions,
  `next.config.ts`) but not stated.

## Auth & Roles

- **Credentials + optional Google OAuth**, session strategy `jwt` (14-day maxAge).
  `src/lib/auth.ts` builds the full NextAuth instance (Node runtime, needs bcrypt); a separate
  `src/lib/auth.config.ts` holds only the Edge-safe pieces (JWT/session callbacks, no providers) so
  `src/proxy.ts` (Next's middleware-equivalent entry point) can gate routes without pulling in
  Node-only bcrypt in the Edge runtime — an explicit two-file split with an inline comment
  explaining why.
- **Registration → pending approval, OR instant-approve via team access code.** `registerAction`
  (`src/app/actions/auth.ts`) finds-or-creates a `Team` by team number, hashes the password
  (bcrypt, cost 12), and sets `status: PENDING` — unless the submitted `accessCode` matches the
  team's stored `Team.accessCode`, in which case the account is created `ACTIVE` with the
  `TEAM_MEMBER` role pre-assigned, skipping human approval entirely.
  `src/app/(app)/settings/members/AccessCodeForm.tsx` lets an admin set/rotate that code.
- **Six roles**, additive not hierarchical except for one blanket override: `TEAM_MEMBER,
  BUILD_LEAD, INVENTORY_ADMIN, BUDGET_MANAGER, SAFETY_CAPTAIN, HEAD_MENTOR`. A user can hold
  multiple roles simultaneously (`UserRole` join table). `src/lib/rbac.ts` provides `hasRole`/
  `hasAnyRole`/`hasMinRank`, all special-casing `HEAD_MENTOR` as an always-true superuser; a
  numeric `ROLE_RANK` table exists (`INVENTORY_ADMIN`/`BUDGET_MANAGER`/`SAFETY_CAPTAIN` share rank
  3) but is only consumed by `hasMinRank`, not obviously wired into every action's guard.
- **Membership approval workflow.** `src/app/actions/members.ts`: `approveMemberAction` (assigns
  roles + flips status to ACTIVE inside a `$transaction`, fires an `ACCOUNT_APPROVED`
  notification), `denyMemberAction`, `updateMemberRolesAction`, `suspendMemberAction` — all gated
  by a `requireAdmin()` helper checking for `HEAD_MENTOR` or `INVENTORY_ADMIN` in the caller's
  roles (an odd pairing — inventory admin doubling as the fallback membership-approval role).
  `src/app/(app)/settings/members/page.tsx`.
- **Account states.** `UserStatus`: `PENDING | ACTIVE | SUSPENDED | DENIED`; a pending/denied user
  is routed to `src/app/(auth)/pending/page.tsx` rather than the app shell.
- **Route gating.** `src/proxy.ts` (NextAuth's own middleware wrapper) redirects any request to a
  non-public path to `/login?callbackUrl=...` when `req.auth` is absent; public paths are
  `/login`, `/register`, `/pending`, `/api/auth`. Per-page role checks (e.g. `requireAdmin()`) are
  additional, not centralized in middleware.
- **No RLS.** Unlike frc-part-tracker's Supabase/Postgres-RLS approach, all authorization here is
  application-level (session + role checks in Server Actions/pages) against a single shared
  Prisma/Postgres connection — the ORM equivalent of "service-role only" with no database-enforced
  tenant isolation.

## Data Model

`prisma/schema.prisma`, one migration. Team 1741's hub, if evaluating Prisma instead of raw
Supabase SQL, would find this the more directly comparable ORM-first schema of the two surveys.
Highlights per module (all IDs are `cuid()`):

- **Auth/Team/Season core** — `User` (status, approval audit fields, `roles: UserRole[]`,
  `displayMode`), `Account`/`Session`/`VerificationToken` (stock NextAuth Prisma-adapter models),
  `Team` (`teamNumber` unique, `accessCode`), `Season` (`@@unique([teamId, year])`, `isActive`
  flag, `kickoffDate`/`week0Date`/`meetingDays[]`/`meetingStartTime`/`meetingEndTime`,
  `expectedAttendance`), `CompetitionEvent` (typed `REGIONAL|DISTRICT|...|OFFSEASON`).
- **Module 1 — Robot Fleet** — `Robot` (per-season, `role` COMPETITION/PRACTICE/DEMO/RETIRED/OTHER,
  `status` a 5-value lifecycle, `weightTarget`, `gallery: String[]`, `archived`), `WeightSnapshot`
  (time-series weigh-ins per robot).
- **Module 2 — Tool Management** — `Tool` (team-scoped, typed `ToolType`, `space`
  SHOP_ONLY/TRAVELS_TO_COMPETITION/COMPETITION_ONLY, `condition`, `requiresCertification` +
  `certificationName`, maintenance interval/due date, `replacementCost`), `ToolCheckout`
  (quantity-aware, `expectedReturn`, `returnCondition`), `ToolMaintenanceLog`,
  `UserCertification` (`@@unique([userId, certName])`, `status` ACTIVE/EXPIRED/REVOKED).
- **Module 3 — Parts/Materials Inventory** — `BaseInventoryItem` (season-scoped stock item: min
  threshold, reorder qty, preferred/alternate supplier + lead days, unit cost vs. fair-market
  value, `isKopItem`/`isFirstChoiceItem` flags), `InUseInventoryItem` (an item pulled onto a robot
  or into use: `source` enum BASE_INVENTORY/KOP/FIRST_CHOICE/DIRECT/DONATED, `subsystem`,
  `onRobotBom`/`packForCompetition` flags), `InUseIssue` (defect reports with severity/status),
  `ReorderRequest` (auto-triggered — see Notable Details).
- **Module 4 — Procurement & Ordering** — `Vendor` (team-scoped, FRC discount note, lead days,
  preferred flag), `ProductDonationVoucher` (PDV tracking: value, expiry, redemption),
  `PurchaseRequest` (season-scoped: sub-team, priority ROUTINE/URGENT/EMERGENCY, justification,
  optional linked `Task`, preferred vendor, budget category, a 7-state `PurchaseStatus` lifecycle
  DRAFT→SUBMITTED→APPROVED/DENIED→ORDERED→PARTIAL_RECEIVED/RECEIVED, plus CANCELLED, approver +
  approval notes), `PurchaseLineItem` (cascades on request delete; can flag
  `goesOnRobotBom`/`isKopSource`, link to a `BaseInventoryItem`).
- **Module 5 — Budget Management** — `Budget` (one per season), `BudgetCategory` (12-value typed
  enum: registration fees, robot mechanical/electrical/pneumatics, raw materials, tools, consumables,
  safety, travel/hotel, food, awards/outreach, contingency, other — each with an `allocation`),
  `FundingSource` (school allocation/corporate sponsor/grant/fundraiser/individual donation/PDV/
  other; status PLEDGED/RECEIVED/PARTIAL), `Expense` (optionally tagged to a category and/or a
  `purchaseRequestId`, `isCommitment` flag for pledged-not-yet-spent), `Sponsor` (agreement
  lifecycle PENDING→AGREEMENT_SENT→SIGNED→THANK_YOU_SENT, renewal-eligible flag).
- **Module 5b — Robot BOM (FIRST cost-cap compliance)** — `BomItem` (per-robot: unit/total fair-
  market value, `source`, three independent exemption flags `exemptUnder5`/`exemptKop`/
  `exemptFirstChoice`, `fmvConfirmed`), `BomExport` (audit record of every CSV export: who, when,
  format).
- **Module 6 — Build-Season Schedule** — `Task` (season + optional robot scope, multi-assignee
  `User[]`, self-referential `prerequisites`/`dependents` many-to-many via an implicit
  `TaskDependencies` join, sub-team, start/due dates *or* a relative `startOffset`/
  `durationBuildDays` pair, 4-level priority, 5-state status NOT_STARTED→IN_PROGRESS/BLOCKED/
  IN_REVIEW→COMPLETE, milestone flag, optional linked `DesignReview`), `DesignReview` (1:1 with a
  task; decision APPROVED/CHANGES_REQUIRED/REJECTED), `SeasonTemplate`/`TemplateTask` (reusable
  task templates with `prerequisiteNames: String[]` — resolved by name, not FK, at apply time).
- **Module 7 — Compliance & Safety** — `SafetyIncident` (severity NEAR_MISS/MINOR_INJURY/
  SIGNIFICANT_INJURY, immediate + corrective action fields), `InspectionChecklist` +
  `InspectionCheckItem` (robot inspection at an event, PASS/FAIL/NOT_CHECKED per item),
  `PreMatchChecklist` + `PreMatchCheckItem` (simpler boolean per-match checklist).
- **Shared** — `Notification` (17-value typed enum covering every module — reorder triggered,
  purchase submitted/approved/denied, order received, task due/overdue/blocked, critical issue,
  weight warning, BOM cap warning, tool overdue, cert expiring, safety incident, competition
  approaching, member approval needed, account approved/denied), `ActivityLog` (generic
  entity/action audit trail — present in the schema but not obviously written to from the actions
  surveyed, so likely under-wired relative to its schema definition).

## Features

- **Register / login / pending-approval gate** — team-number-based signup (auto-creates the team
  row if the number is new), optional instant-approve access code, bcrypt credentials login, a
  dedicated `/pending` holding page for unapproved accounts. `src/app/(auth)/{login,register,
  pending}/page.tsx`, `src/app/actions/auth.ts`.
- **Google OAuth login** — conditionally enabled provider (only registered if both env vars are
  set), alongside credentials. `src/lib/auth.ts`.
- **Member approval console** — pending members list with an approve dialog (pick roles) or deny
  button (with reason); active members list with an inline role editor; suspend action; team
  access-code management. `src/app/(app)/settings/members/*`, `src/app/actions/members.ts`.
- **Season setup and switching** — create a season (kickoff date, Week 0 date, meeting days/times,
  expected attendance) which auto-deactivates any prior active season; edit the active season; add
  robots to a season. `src/app/(app)/settings/season/*`, `src/app/actions/season.ts`.
- **Dashboard** — cross-module summary landing page (not deeply inspected page-by-page here, but
  present at `src/app/(app)/dashboard/page.tsx`).
- **Robot Fleet list + detail** — per-robot page with a weight-logging widget (`WeightLogger.tsx`)
  writing to `WeightSnapshot`; edit robot metadata (role/status/description/weight target); archive
  a robot. `src/app/(app)/fleet/page.tsx`, `fleet/[id]/page.tsx`, `src/app/actions/fleet.ts`.
- **Tool catalog + checkout/check-in** — add a tool (type, space, condition, certification
  requirement, maintenance interval, replacement cost); checkout enforces both a quantity-available
  check (`quantityOwned` minus active checkouts) and a certification check (blocks checkout if the
  tool `requiresCertification` and the user lacks an ACTIVE `UserCertification` for that name);
  check-in records return condition and downgrades the tool's own condition if returned damaged;
  retire a tool. `src/app/(app)/tools/*`, `src/app/actions/tools.ts`.
- **Certifications management** — award (upsert, so re-awarding refreshes dates) or revoke a
  member's certification. `src/app/(app)/safety/certifications/*`, `src/app/actions/safety.ts`.
- **Parts/materials inventory with auto-reorder** — add a base stock item (category, unit of
  measure, min-stock threshold, reorder quantity, KOP/First-Choice flags, unit cost + FMV);
  "acquire" pulls stock into an `InUseInventoryItem` against a robot/location/subsystem and, if the
  resulting stock level is at-or-below the min threshold, automatically creates a `ReorderRequest`
  for the configured reorder quantity — no human has to notice the low stock.
  `src/app/(app)/inventory/*`, `src/app/actions/inventory.ts`.
- **Reorder request queue** — dismiss (with resolved timestamp) a pending auto-generated reorder.
  `dismissReorderAction` in `src/app/actions/inventory.ts`.
- **Vendor directory** — add/edit vendors (FRC discount notes, lead days, preferred flag), a "seed
  vendors" quick-start button. `src/app/(app)/procurement/vendors/*`, `src/app/actions/vendor.ts`.
- **Purchase request workflow with auto-approval threshold** — submit a request with one or more
  line items (part name, vendor URL, quantity, unit cost); estimated total computed server-side;
  requests at or under a hardcoded $50 threshold *and* not marked EMERGENCY are auto-approved on
  submission, everything else goes to SUBMITTED and notifies every `BUDGET_MANAGER`/`HEAD_MENTOR`
  on the team (with a 🚨-prefixed title for emergencies); admin approve/deny (denial requires a
  reason, notifies the requester); mark-ordered (confirmation number, actual total, expected
  delivery) and mark-received transitions. `src/app/(app)/procurement/*`,
  `src/app/actions/procurement.ts` (`AUTO_APPROVE_THRESHOLD = 50`).
- **Budget setup** — one form allocates dollar amounts across all 12 fixed budget categories plus a
  total estimated revenue figure; idempotent upsert (creates or updates the season's `Budget` +
  its `BudgetCategory` rows in one pass). `src/app/(app)/budget/setup/*`,
  `setupBudgetAction` in `src/app/actions/budget.ts`.
- **Funding sources and expense log** — add a funding source (type, amount, pledged/received/
  partial status) or log an expense (date, amount, vendor, optional category, optional
  "is a pledged commitment not yet spent" flag). `src/app/(app)/budget/*Dialog.tsx`,
  `addFundingSourceAction`/`logExpenseAction` in `src/app/actions/budget.ts`.
- **Sponsor tracking** — present in the schema (`Sponsor` model with agreement lifecycle); no
  dedicated action/page file was found among the surveyed files, suggesting this piece of Module 5
  is schema-only/thinner than the rest.
- **Robot BOM with live FIRST $5,000 cost-cap tracking** — add BOM line items (part name/number,
  subsystem, quantity, unit FMV, source, KOP/First-Choice exemption checkboxes); the page computes
  "countable FMV" (excludes anything flagged KOP-exempt, First-Choice-exempt, or under $5 per the
  FIRST rule that sub-$5 components don't count) and renders a color-coded progress bar
  (green/amber/red at 80%/95% of $5,000) plus an "items with unconfirmed FMV" warning banner.
  `src/app/(app)/budget/bom/page.tsx`, `src/app/actions/bom.ts`.
- **FIRST-format BOM CSV export** — downloads a CSV with the standard BOM columns plus totals rows
  (countable FMV, cap, remaining), records the export in `BomExport` for audit purposes.
  `src/app/api/bom-export/route.ts`.
- **Task list, detail, and creation with dependencies** — create a task (sub-team, robot link,
  dates or offsets, priority, milestone flag, design-review-required flag, multi-assignee,
  multi-prerequisite); status-only quick update; delete; log actual hours spent.
  `src/app/(app)/schedule/tasks/*`, `src/app/actions/tasks.ts`.
- **Design review gate on tasks** — marking a task `designReviewRequired` sets its
  `designReviewStatus` to PENDING automatically; a separate `DesignReview` record captures the
  decision. Schema present; the review-recording UI wasn't located among the files read in depth.
- **Standard build-season milestone template** — a hardcoded 20-item FRC build-season milestone/task
  list (game analysis, strategy, subsystem design reviews, prototyping, CAD complete, drivetrain
  driving, full integration, driver practice, weight-under-limit, BOM complete, documentation,
  Week 0) with per-item offsets relative to kickoff (positive) or Week 0 (negative); one click
  applies every milestone not already present by name to the active season.
  `applyStandardTemplateAction` in `src/app/actions/templates.ts`,
  `src/app/(app)/schedule/templates/ApplyTemplateButton.tsx`. Also a "clear all tasks" action.
- **Gantt chart** — a hand-built (no charting library) day-by-day timeline from kickoff to Week 0,
  grouped by sub-team, milestone diamonds vs. duration bars, non-build-day shading (based on the
  season's configured meeting days), a "today" marker line, filterable by sub-team via query
  param. `src/app/(app)/schedule/gantt/page.tsx`.
- **Safety incident reporting** — file an incident (date, description, severity, tool/material,
  people involved, immediate/corrective action). `src/app/(app)/safety/incidents/new/*`,
  `fileIncidentAction` in `src/app/actions/safety.ts`.
- **Robot inspection checklist** — one click seeds a fixed 19-item FIRST inspection checklist
  (weight ≤115/135 lbs, frame perimeter, bumper construction/labeling, main breaker, wiring, legal
  motor controllers/motors, pneumatics pressure ≤120 PSI, RSL, radio, roboRIO/DS software versions,
  BOM ≤ $5,000, prohibited materials, hazardous protrusions) against a robot for a named event; per-
  item pass/fail/not-checked toggling. `src/app/(app)/safety/inspection/*`,
  `createInspectionChecklistAction`/`updateCheckItemAction` in `src/app/actions/safety.ts`.
- **Pre-match checklist** — schema present (`PreMatchChecklist`/`PreMatchCheckItem`); no dedicated
  action/page located among the files inspected — likely schema-only/unfinished, unlike the
  inspection checklist which is fully wired.
- **In-app notification center** — bell/list UI backed by `GET/POST /api/notifications` (list
  latest 20, mark a set of IDs read); a "mark all read" button.
  `src/app/(app)/notifications/*`, `src/app/api/notifications/route.ts`.
- **Server-triggered notifications across modules** — role-targeted (`notifyTeam`) or single-user
  (`createNotification`) notifications fire from: purchase request submission/approval/denial,
  member approval. The 17-value `NotificationType` enum implies several more trigger points
  (reorder, task overdue/blocked, tool overdue, cert expiring, weight/BOM-cap warnings,
  competition-approaching) than were confirmed wired in the action files inspected — the enum is
  broader than the visibly-implemented trigger sites, suggesting some notification types are
  aspirational/schema-first.

Not present: no automated tests of any kind, no seed script, no CSV/Excel import (only BOM export),
no OnShape/CAD integration (unlike frc-part-tracker), no external vendor-catalog integration.

## Integrations

- **Google OAuth** (optional, conditionally registered) — the only third-party identity provider.
  `src/lib/auth.ts`.
- **NextAuth/Prisma stack** — no external SaaS integrations (no Slack/email/calendar); all
  "integration"-shaped features (BOM CSV export, standard milestone template, inspection checklist)
  are internal generators, not calls to external services.
- No CAD system integration (contrast with frc-part-tracker's deep OnShape client) — task/BOM data
  is entered by hand, not synced from a design tool.

## Notable Implementation Details

- **Edge-vs-Node auth split.** `src/lib/auth.config.ts` deliberately contains zero Node-only
  imports (no bcrypt, no Prisma client) so `src/proxy.ts` (which runs in the Edge runtime) can call
  `NextAuth(authConfig)` for session/JWT checks without pulling in bcrypt; the full provider list
  (Credentials, Google) plus the Prisma adapter live only in `src/lib/auth.ts`, imported by
  Node-runtime code (API routes, Server Components, Server Actions). Both files carry comments
  explaining the split — a directly reusable pattern for any Next.js + NextAuth-v5 + bcrypt app.
- **The FIRST $5,000 cost-cap logic is real and load-bearing**, not just a labeled field: three
  independent boolean exemptions (`exemptUnder5` computed server-side from `unitFmv < 5`,
  `exemptKop`, `exemptFirstChoice`) are combined with an OR to decide what counts toward the cap,
  both on the live progress-bar page and in the exported CSV's totals rows — the two code paths
  (`src/app/(app)/budget/bom/page.tsx` and `src/app/api/bom-export/route.ts`) duplicate the same
  `countableFmv` filter/reduce rather than sharing a helper, so a future rule change (e.g. FIRST
  adjusting the cap or exemption rules) would need to be updated in both places.
  `BOM_CAP = 5000` is a literal in both files rather than a shared constant.
  `src/app/(app)/budget/bom/page.tsx`, `src/app/api/bom-export/route.ts`.
- **Auto-approval threshold is a bare literal, not configurable.** `AUTO_APPROVE_THRESHOLD = 50` in
  `src/app/actions/procurement.ts` is hardcoded; a team wanting a different threshold (or a
  per-category threshold) would need a code change, not a settings-page toggle.
- **Auto-reorder is silent stock-driven automation, no polling.** `acquireItemAction`
  (`src/app/actions/inventory.ts`) checks `newStock <= item.minStockThreshold` synchronously inside
  the same mutation that decrements stock — a `ReorderRequest` is created in the same request/
  response cycle as the stock pull, not via a scheduled job or trigger.
  Reasonable for a low-traffic team app; would race under concurrent acquires against the same
  item (no row lock / transaction wrapping the read-then-write), a gap a Postgres-native
  implementation (e.g. an `AFTER UPDATE` trigger, as frc-part-tracker uses elsewhere) would close.
- **Template tasks resolve prerequisites by name, not ID.** `SeasonTemplate`/`TemplateTask.
  prerequisiteNames: String[]` stores prerequisite *names* rather than FKs, deferring resolution to
  apply-time task-name matching; the standard-milestone applier
  (`applyStandardTemplateAction`) sidesteps this entirely by checking for an existing task with the
  same `name` and skipping duplicates, rather than by consuming the `TemplateTask` model at all —
  the 20-item standard template is a hardcoded array in the action file, separate from the
  `SeasonTemplate`/`TemplateTask` schema models that exist for *user-defined* templates.
- **`NotificationType` enum is broader than its confirmed call sites.** Of 17 notification types,
  only member-approval and purchase-request transitions were confirmed wired to an actual
  `createNotification`/`notifyTeam` call among the action files inspected; types like
  `TOOL_OVERDUE`, `CERT_EXPIRING`, `WEIGHT_WARNING`, `BOM_CAP_WARNING`, and
  `COMPETITION_APPROACHING` imply scheduled/threshold-triggered checks that would need a cron-style
  job — none was found in the repo (no scheduled functions, no `/api/cron` route). Treat these as
  designed-but-not-yet-implemented rather than working notification triggers.
- **`ActivityLog` model exists but no write call was found** in any of the ~2,200 lines of action
  code surveyed — likely schema-first scaffolding for an audit-log feature not yet wired up.
- **Season-scoped multi-tenancy, not row-level security.** All authorization is Prisma
  query-filter-based (`where: { teamId: session.user.teamId }` / `season: { teamId: ... }`)
  enforced per-query in application code; there is no database-level RLS as in
  frc-part-tracker's Supabase schema — a missed `teamId` filter in a future query would leak
  cross-team data with nothing at the database layer to catch it.
- **Single squashed commit, no CI, no tests.** `git log` shows exactly one commit for the entire
  repo; there's no `.github/workflows`, no test files (`*.test.*`/`*.spec.*`) anywhere. Combined
  with the boilerplate README and the `AGENTS.md`/`CLAUDE.md` Next.js-agent-rules block, this reads
  as an AI-agent-generated demonstration/portfolio build rather than a team's production tool —
  useful as a feature-completeness reference, not as a template for reliability practices.
