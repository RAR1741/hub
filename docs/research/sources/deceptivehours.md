# DeceptiveHours — Source Survey

**Repo:** FRC4392/DeceptiveHours — https://github.com/FRC4392/DeceptiveHours
**Surveyed-at:** f608065acec11261cde2f1fe82e1f02087e4d83b
**Permalink form:** https://github.com/FRC4392/DeceptiveHours/blob/f608065acec11261cde2f1fe82e1f02087e4d83b/<path>
**Stack:** React 19 + TypeScript (strict), Vite 8, React Router 7 (SPA mode), Tailwind CSS v4 + shadcn/ui, Convex (backend/DB/functions), Clerk (auth), Bun, Netlify (deploy)
**License:** none (all rights reserved) — no LICENSE file present in the tree; ideas only.
**Last activity:** 2026-07-13 (pushed_at)
**FRC team:** 4392 ("Deceivers")
**Areas:** (1) time/attendance, (2) people/rosters

## Purpose
A hour-tracking system for an FRC team: a shared, mentor-unlocked kiosk (`/clock`) where members clock in/out by typing or QR-scanning a Member ID, and a protected mentor dashboard/roster app for reviewing live attendance, aggregate hours, and managing the member list and user accounts.

## Auth & Roles
Clerk is the sole identity provider — no local passwords, no public sign-up. Convex verifies Clerk JWTs via `convex/auth.config.ts` (`CLERK_JWT_ISSUER_DOMAIN`). Two roles only: `student` and `mentor`, stored as `teamMembers.type`, driven from Clerk `publicMetadata.role`. All Convex queries/mutations gate through `requireMentor()` (`convex/authz.ts`) — every dashboard/roster/session endpoint is mentor-only; there is no student-facing app surface at all (students only exist as kiosk-scanned subjects). New accounts are created only by an already-signed-in mentor via an "Invite User" flow that calls Clerk's invitation API (`convex/clerk.ts` `inviteUser`); acceptance triggers a Clerk `user.created` webhook that upserts the `teamMembers` row (`convex/http.ts`, `convex/auth.ts`). Kiosk itself has no separate auth — it's just an unlocked screen under an already-authenticated mentor's browser session; the "student" role only gates what happens after invite-accept.

## Data Model
Three Convex tables (`convex/schema.ts`):
- **teamMembers**: `clerkUserId` (legacy fallback), `authTokenIdentifier` (current provider-scoped id, preferred), `email`, `firstName`, `lastName`, `memberId` (10-digit, `4392`-prefixed, unique, generated), `type` (student/mentor), plus student-only `studentStartYear`, `studentGrade` (6-12 or "alumni"), `studentGradeAsOfSchoolYear` (anchor year for auto-advancement). Indexed by memberId, clerkUserId, authTokenIdentifier.
- **clockSessions**: `teamMemberId` (FK), `clockIn`, `clockOut` (optional = open session), `status` ("open"/"closed", added mid-project as a widen-migrate-narrow rollout over the older clockOut-null convention — `sessionStatus()` in `convex/hours.ts` interprets both). Indexed by teamMemberId, teamMemberId+clockIn, teamMemberId+status, and status alone.
- **appSettings**: generic `key`/value row; used for a single `"hoursRange"` row storing global `hoursRangeStart`/`hoursRangeEnd`.

## Features

### Time/attendance
- **Kiosk clock in/out** (`src/routes/time-clock.tsx`, `convex/clockSessions.ts` `clockIn`/`clockOut`) — member enters/scans Member ID, sees name/status/live timer, single button toggles open/closed session; server enforces "already clocked in"/"not clocked in" and rejects overlapping sessions (`assertNoOverlappingSession`).
- **QR code scanning at the kiosk** (`src/components/qr-scanner.tsx`, README/manual) — camera-based scan via `jsQR`, manual ID entry remains the fallback.
- **Per-member QR code generation** (member detail page) — printable QR encoding the memberId for members without a badge to scan.
- **Global configurable reporting range** (`convex/settings.ts`, `convex/hours.ts`) — one saved start/end date pair used by dashboard, kiosk, and member detail; defaults to Jan 1 of current year; pages can "Apply" a temporary override without changing the saved default.
- **Mentor dashboard live view** (`convex/dashboard.ts` `getDashboardData`, `src/routes/dashboard.tsx`) — currently-clocked-in grid with running timers, total-hours and total-members summary cards, full roster sorted by completed hours descending, CSV export of the visible table.
- **Manual session CRUD** (`convex/clockSessions.ts` `addSession`/`updateSession`/`deleteSession`) — mentors can add a session with explicit clock-in/out, edit times on an existing row, or delete a row (including an in-progress/open one) to fix a missed clock-out.
- **Session history + exports per member** (`src/routes/members/detail.tsx`) — raw session table for the reporting range with edit/delete per row; CSV export includes raw sessions plus daily and Monday-Sunday weekly summaries (`src/lib/csv.ts`).
- **Completed-hours aggregation logic** (`convex/hours.ts` `completedMsForRange`) — only closed sessions with a clockOut count toward totals; open/in-progress sessions are shown live but excluded from the completed total until closed.

### People/rosters
- **Auto-generated Member IDs** (`convex/auth.ts` `generateMemberId`) — 10-digit `4392`-prefixed IDs, retried up to 25 times against a uniqueness index.
- **Roster listing with search/filter/sort** (`src/routes/members/index.tsx`) — search by name/email/memberId, filter by role and grade, sort by name/type/grade/memberId, CSV export of visible rows.
- **Student grade tracking with auto-advancement** (`convex/studentInfo.ts`) — `studentGrade` (6-12/alumni) recorded against a school-year anchor (`studentGradeAsOfSchoolYear`); `computeDisplayGrade()` derives the current displayed grade by advancing from the anchor year, rolling to "Alumni" once past 12. School year boundary is July 1 (`currentSchoolYear`).
- **User invite/remove flow** (`convex/clerk.ts`, `src/routes/users/index.tsx`) — mentor invites by email + role via Clerk's invitation API; removal deletes the Clerk account (`removeUser`, blocks self-removal) which cascades to the local roster row and all clockSessions on next sync/webhook.
- **Member detail edit** (`convex/teamMembers.ts` `update`) — local correction of name/memberId/type/grade fields; explicitly documented as a local-only patch since Clerk webhooks remain the roster source of truth and could overwrite it.
- **Public-safe member lookup shape** (`convex/teamMembers.ts` `publicMemberDoc`) — a deliberately narrowed response type (excludes email/clerkUserId/authTokenIdentifier) for the two endpoints reachable via a guessable memberId, even though both endpoints are still mentor-gated.
- **Bulk Clerk sync** (`convex/clerk.ts` `syncUsers`, `convex/auth.ts` `syncClerkUsers`) — paginates the full Clerk user list, upserts every user into `teamMembers`, and deletes local rows whose Clerk user no longer exists; refuses to run if the full list couldn't be fetched or if the calling mentor isn't present in the fetched set (guards against a partial-list wipe).
- **Bulk invite script** (`scripts/bulk-invite-clerk.ts`) — standalone script for inviting many users into Clerk at once (roster seeding/migration tool).

## Integrations
- **Clerk** — full auth provider: sign-in UI embedded via Clerk's components, invitations, MFA, password reset, and the source-of-truth roster sync via webhooks (`user.created/updated/deleted` → `convex/http.ts`) verified with hand-rolled Svix HMAC signature checking (timing-safe compare, 5-minute freshness window).
- **Convex** — backend-as-a-service: schema, queries/mutations/actions, HTTP router, scheduled/background sync all in `convex/`.
- **Netlify** — CI/CD: `netlify.toml` runs `npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'bun run build'` so a Netlify build also deploys the Convex backend.
- No Slack/Discord/email/SMS/TBA/Onshape integration.

## Notable Implementation Details
- **Migration discipline**: the `clockSessions.status` field was added as an optional column with an explicit "widen-migrate-narrow" comment in the schema; `sessionStatus()` reads status if present, else derives it from `clockOut`, so old and new rows coexist safely during rollout. A `convex/migrations.ts` module handles backfills (e.g., `backfillClerkAuthTokenIdentifiers`, `clearWorkosEraRoster`) gated by an `ENABLE_DESTRUCTIVE_MIGRATIONS` env flag and confirmation strings.
- **Auth identity migration**: the project moved from a legacy Clerk-subject-only lookup to a provider-scoped `authTokenIdentifier` (`issuer|clerkUserId`), with `getCurrentMember()` trying the new index first and falling back to the old `clerkUserId` index — a pattern worth copying for any provider-identifier rename.
- **Overlap prevention**: `assertNoOverlappingSession` checks a bounded window (last 500 sessions) for any interval intersection before allowing clock-in, add, or edit — prevents double-booked/overlapping attendance windows.
- **Scale note**: several queries `.take(500)` and treat hitting the cap as an error condition (e.g., `remove` refuses to cascade-delete if a member has 500+ sessions) rather than paginating — fine at FRC team scale, would need revisiting for a much bigger roster/session history.
- **Security-conscious response shaping**: even though both current callers of `lookupByMemberId`/`getById` are mentor-gated, the code still trims PII/internal IDs out of the returned shape "in case" — a defensible pattern for endpoints reachable via a guessable public identifier.
- **CSV/export code lives entirely client-side** (`src/lib/csv.ts`) — no server-side report generation; exports operate on whatever rows are currently rendered/fetched.
- **Self-hosted webhook verification** — no SDK dependency for Clerk webhook checking; hand-implemented Svix HMAC-SHA256 verification directly against Web Crypto (`convex/http.ts`), including timestamp freshness and timing-safe byte comparison.

## Verdict
Substantive and directly on-target for time/attendance + roster management — small, clean Convex+Clerk stack with concrete, copyable patterns: kiosk clock-in/out with overlap detection, global+per-page reporting ranges, auto-advancing student grades on a school-year boundary, and a careful Clerk-webhook-driven roster sync (including a migration-safe identifier rename and a safeguarded bulk-sync). No license file, so treat as ideas-only, not reusable code.
