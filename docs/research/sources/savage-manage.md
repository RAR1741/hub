# Savage Manage — Source Survey

**Repo:** axyklee/savage-manage — https://github.com/axyklee/savage-manage
**Surveyed-at:** 60f341594dbbfc7f5d9273fb50ec4a84d31cb9df
**Permalink form:** https://github.com/axyklee/savage-manage/blob/60f341594dbbfc7f5d9273fb50ec4a84d31cb9df/<path>
**Stack:** TypeScript, Next.js (pages router), React, Chakra UI, FullCalendar, MUI DataGrid, tRPC, Prisma + PostgreSQL, bcrypt + jsonwebtoken auth, Resend for transactional email
**License:** none found (no LICENSE file, README has no license section) — ideas only, all rights reserved by default
**Last activity:** 2023-08-25 (pushed_at)
**FRC team:** 6947, "Savage Tumaz" (stated explicitly in README)
**Areas:** people/rosters (primary), time/attendance, communication (email notifications), light finance/parts-adjacent tracking (transaction/reimbursement ledger — not a PO system)

## Purpose
A single internal web app for an FRC team to manage its roster (members, roles, account types), a shared events calendar with attendance check-in/out and RSVP, and a basic finance/reimbursement ledger — replacing spreadsheets with one role-permissioned tool. Explicitly labeled "in development," but the schema and routers are functionally complete for roster + planner + a first pass at finance.

## Auth & Roles
- Custom auth: email + bcrypt-hashed password (`src/server/routers/auth.ts`), no OAuth/SSO.
- On login, a JWT is signed (`jsonwebtoken.sign`, `JWT_SECRET` env) embedding a `PublicUserType` session payload (id, grade, class, roles, accountType, etc.) and set as an `HttpOnly; SameSite=Strict` cookie (`token`), 1-day expiry.
- Two orthogonal grouping concepts: `AccountType` (e.g. student/mentor/alumni, single per user, has a display color) and `Role[]` (many-to-many, each role carries a `priority` for sort order and a `color`, plus a bundle of boolean permission flags).
- Permission model is a flat set of ~12 named booleans per role (`src/utils/permissions.ts`): `allowViewEvent`, `allowCreateEvent`, `allowEditEvent`, `allowViewAllInfo`, `allowCreateUser`, `allowEditUser`, `allowViewFinances`, `allowViewAllFinances`, `allowCreateTransaction`, `allowEditTransaction`, `allowApproveTransaction`, `allowReimburseTransaction`. Each has a human name + description shown to admins.
- Enforcement is centralized in tRPC middleware (`src/server/trpc.ts`): `permissionProcedure(permission)` wraps a procedure to require a permission; `hasPermissionInProcedure(permission, ctx)` is used ad hoc inside a query to branch behavior (e.g., "see everything" vs "see only my own/allowed records"). `loggedInProcedure` just requires a valid session.
- Sidebar navigation is permission-filtered server-side: `permissionsRouter.getSidebarItems` (`src/server/routers/permissions.ts`) maps each `linkItems` entry's required permission (string or array/OR) through `hasPermissionInProcedure` and returns only the visible items — the client never has to hide nav items itself.

## Data Model
(`prisma/schema.prisma`, PostgreSQL)
- `User` — email/studentId (unique), grade, class (enum HO/PING — school class sections), number, English/Chinese name, hashed password, belongs to one `AccountType` (default id 1) and many `Role`s; has `Attendance[]`, `RSVP[]`, `allowedEvents: Event[]`, `Transaction[]`, `FinanceEvents[]`.
- `AccountType` — named category with a color, one-to-many with `User`.
- `Role` — name, color, `priority` (sort order) + the full permission-flag bundle described above; many-to-many with `User`; mapped to table `roles`.
- `Event` — name/description/color, `startAt`/`endAt`; `useAttendance` toggle + `attendanceTimeout` (minutes) driving `Attendance[]`; `useRSVP` toggle + `rsvpBefore` (days) driving `RSVP[]`; `allowedUsers: User[]` (explicit invite list independent of RSVP).
- `Attendance` — per-user per-event `checkInAt`/`checkOutAt`.
- `RSVP` — per-user per-event `confirmed` boolean (yes/no), distinct from mere event visibility (`allowedUsers`).
- `Transaction` — user-owned finance request: title/description, `attachments: String[]`, `amount`/`currency` (default NTD — Taiwan New Dollar, confirming a Taiwan-based team), `status` enum (`PENDING`/`APPROVED`/`PARTIALLY_APPROVED`/`REJECTED`/`REIMBURSED`).
- `FinanceEvents` — an audit/comment trail per `Transaction` (`eventType`, `message`, `attachments`, `createdBy: User`) — a log of status changes/notes rather than a full PO workflow.

## Features
**People / rosters**
- Full HR CRUD: create/edit/delete user (`src/server/routers/user.ts`: `create`, `edit`, `delete`), each gated by `allowCreateUser`/`allowEditUser`.
- Role and account-type management UI as separate admin screens: `src/components/Dashboard/HumanResources/HRRoles.tsx`, `HRList.tsx` (roster table), `HRCreateUser.tsx`, `HREditUser.tsx`, `HRViewUser.tsx`, wrapped by `src/components/Dashboard/HumanResourcesWrapper.tsx`.
- Role editor exposes every permission flag as a checkbox generated dynamically from the `permissions` catalog (`user.ts` `editRole` + `getRolesWithPermissions`, using `fillPermissions()` to build a zod schema across all flags at once — avoids hand-listing every permission field in multiple places).
- Account types and roles both carry a `userCount` computed via a `users: { select: { id: true } }` sub-select and `.length` — a lightweight member-count-per-group aggregation pattern (`user.ts` `getRoles`, `getAccountTypes`).
- Self-service vs admin visibility split: unprivileged users only ever see their own record; `allowViewAllInfo` unlocks the full roster and the `get`/`all` endpoints.

**Time / attendance**
- Event-level attendance toggle (`useAttendance`) with a configurable check-in timeout (`attendanceTimeout`, minutes) — implies a check-in grace window pattern worth reusing.
- `Attendance` model captures explicit `checkInAt`/`checkOutAt` timestamps per user per event (schema only in this snapshot; UI for recording it lives under the Planner event view, `src/components/Dashboard/Planner/EventView.tsx`).

**Communication**
- RSVP flow with a deadline (`rsvpBefore`, days-before-event) enforced at event-create time (`plannerRouter.create` throws if `useRSVP` is set without a deadline).
- Admin can force-set a user's RSVP/invite status via `adminEditRsvp` (`planner.ts`) — a single mutation handling four states (not invited / invited-no-response / declined / confirmed) by juggling `RSVP` rows and the `allowedUsers` relation.
- Transactional email on account creation and edit via Resend (`user.ts` `create`/`edit`), using a shared branded template component `src/server/EmailBase.tsx` (React-rendered HTML email, includes credentials in the welcome email — see gotcha below).

**Finance / reimbursement (adjacent to parts-ordering)**
- `Transaction` + `FinanceEvents` model a lightweight approval pipeline (submit → approve/partially-approve/reject → reimburse) with an audit trail, gated by four granular permissions (create/edit/approve/reimburse) plus a view-own vs view-all split — this is the closest thing in-repo to a PO/expense-approval workflow, though UI (`src/components/Dashboard/Finances.tsx`) wasn't fully read in this pass.

**Planner / calendar**
- FullCalendar-based shared calendar (`src/components/Dashboard/Planner/Calendar.tsx`, `AddEvent.tsx`, `EditEvent.tsx`, `EventView.tsx`, `EditEventStatusSelect.tsx`).
- Visibility-scoped event queries: users without `allowViewAllInfo` only see events they're explicitly invited to (`allowedUsers`) or have RSVP'd to — same pattern applied consistently in both `getMany` and `get` (`planner.ts`).
- Bulk event creation from a comma-separated list of start datetimes plus a single duration (`HH:MM`) — one `create` call can seed a recurring/multi-session event (`planner.ts` `create`, splitting `input.start` on `,`).

## Integrations
- Resend (email delivery) — `src/server/resend.ts`, used for account-creation/edit notifications.
- No Onshape/TBA/Slack/Discord/SMS/Google integrations present.

## Notable Implementation Details
- **SQL-injection-shaped permission check**: both `hasPermission` (tRPC middleware) and `hasPermissionInProcedure` in `src/server/trpc.ts` build a raw SQL string via template interpolation — `` `SELECT "${permission}" FROM roles WHERE name='${ctx.session.user.roles[role].name}'` `` — passed to `prisma.$queryRawUnsafe`. The permission name is validated against a fixed key set first, but the *role name* is not escaped; role names come from the DB (only admins can create roles) so exploitability is low, but this is a pattern to avoid, not copy — Prisma's typed query builder (`ctx.prisma.role.findFirst`) would remove the risk entirely for the same lookup.
- **Passwords emailed in plaintext**: the welcome email embeds the raw password the admin typed in (`user.ts` `create`, `input.password` interpolated directly into `htmlContent`) — a re-implementation should send a reset link instead.
- **Server-filtered nav** rather than client-side conditional rendering (`permissionsRouter.getSidebarItems`) is a clean pattern: it composes the same `hasPermissionInProcedure` used for data access, so nav visibility and data access can't drift apart.
- **`fillPermissions()` helper** dynamically builds a zod object (and Prisma select map) from the single `permissions` catalog object, so adding a new permission flag only requires editing one file instead of every router/schema that references the set — a decent "single source of truth" pattern for a growing permission list.
- Bulk-create event loop (`planner.ts` `create`) uses `.map(async ...)` without awaiting the returned promises array (`input.start.split(',').map(async (val) => {...})` — result discarded) — the caller doesn't actually wait for all events to be created before responding; a correctness gotcha to fix if reusing this pattern (should use `Promise.all`).
- Small scale by construction: single-team roster, no pagination visible on `user.all`/planner queries — fine at FRC-team scale (tens of members) but not designed to scale further.

## Verdict
Substantive and directly relevant for the people/rosters and time/attendance areas — a real, if mid-sized, Next.js+Prisma+tRPC app with a working granular permission system, RSVP/attendance modeling, and a role-priority + account-type dual-grouping scheme worth reusing conceptually. No license file, so treat everything here as ideas-only, no code reuse. Worth stealing: the flat boolean-permission-catalog pattern (`permissions.ts` + `fillPermissions()`), the server-side nav-filtering-by-permission pattern, and the Event `useAttendance`/`useRSVP` opt-in toggles with timeout/deadline fields. Avoid: the raw-SQL permission lookup and emailing plaintext passwords.
