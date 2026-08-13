# M6 — Student self-service excusal requests + hours-goal nudges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.
> Tracks GitHub issue [#28](https://github.com/RAR1741/hub/issues/28).

**Goal:** Let students request excused absences (mentors approve, creating a normal `excusal`), and surface an hours-goal progress bar + missed-required-days nudges on the student dashboard and My Attendance.

**Architecture:** Same seams as M1–M5. A new `excusal_request` table mirrors the existing `account_request`/`membership_application` review pattern. Pure logic (parsers, hours-goal math) in `src/lib/` with Vitest; reads via service-role `getDb()` in server components; mutations via `withRole`-guarded routes — except the student *create* route, which is gated by any signed-in viewer creating a request **for themselves only** (person_id from the viewer, never the body). Approval reuses the existing `excusal` model, so attendance math / the calendar grid need no changes.

**Tech stack:** As-built (Next.js 16.3, Supabase, Tailwind v4, Vitest, Playwright). No new deps.

## Global Constraints (binding for every task)

- Everything runs in the dev container via `./dev`. **Git runs on the HOST.** Push after every commit. TS strict; Node 22.
- All timestamps `timestamptz`; UUID PKs via `gen_random_uuid()`. Dates are `date`. Store UTC; day-boundary logic converts through `team_timezone` (existing helpers in `src/lib/attendance.ts`).
- **RLS enabled on every new table with ZERO policies** — service-role-only.
- Roles admin/mentor/captain/student(+guest); ranks guest<student<captain<mentor<admin. **Excusal-request review is `withRole("mentor")`** (mentors+ only, per issue decision). The student create route is any signed-in viewer, self-scoped.
- Match the current design system (component classes `.card`/`.btn*`/`.pill`/`.table`/`.stat`/`.input`/`.label`, `<Icon/>`, tokens, light/dark). Plain semantic HTML.
- **All Vitest unit tests and all Playwright E2E specs stay green** (add tests for new logic). Preserve E2E-asserted text/roles (Kiosk/Leaderboard nav, "Sign in" button, "signed in as", `/Calendar/` + `/Flagged sessions/` headings, kiosk flow).
- `[id]` routes: `type Ctx = { params: Promise<{ id: string }> }` + `await context.params`. Public/self routes rate-limited via `createRateLimiter`/`clientIp`. Reuse validate helpers (`reqString`/`optString`).
- **Dev-server restart** before live route checks: two separate detached execs (`docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "pkill -9 -f next-server"`; sleep 4; `... exec -d app bash -lc "cd /workspaces/hub && npm run dev > /tmp/nextdev.log 2>&1"`; poll to 200). Chromium for Playwright if missing: `./dev npx playwright install --with-deps chromium`.
- **New migrations must also be applied to the hosted prod DB** (via `supabase db push` or the Supabase MCP `apply_migration`) — flag it in the task report; the controller applies it.

**Existing interfaces consumed:** `withRole` (`src/lib/api.ts`); `getViewer` (`src/lib/viewer.ts`); `getDb` (`src/lib/db.ts`); `getSetting`/`setSettings` (`src/lib/settings.ts`, `src/lib/app-settings-admin.ts`); `createExcusal`/`listExcusals` (`src/lib/excusals.ts`); attendance math (`src/lib/attendance.ts` — `attendanceForDate`/`attendanceSummary`); `personSessions`/`totalHours` (`src/lib/reports.ts`/`hours.ts`); build-days (`src/lib/build-days.ts`); the review-queue pattern in `src/app/admin/requests/page.tsx` + `src/lib/requests.ts` + `RequestActions`; `getActivePeriod` (`src/lib/periods.ts`). Settings `season_hours_goal` is new.

---

### Task 1: Schema (`excusal_request`) + types + `season_hours_goal`

**Files:** new migration via `./dev npx supabase migration new excusal_requests`; `src/lib/types.ts` (+test).

- [ ] Migration: `excusal_request (id uuid pk default gen_random_uuid(), person_id uuid not null references person(id) on delete cascade, date date not null, reason text, status text not null default 'pending' check (status in ('pending','approved','denied')), reviewed_by uuid references person(id), reviewed_at timestamptz, created_at timestamptz not null default now())`. RLS enabled, **zero policies**. Partial unique index `one_pending_excusal_request_per_person_date on excusal_request (person_id, date) where status = 'pending'`. Index on `(status)` for the pending queue. Seed `app_setting` `season_hours_goal` = `0` (jsonb number) — "no goal".
- [ ] Types: `ExcusalRequestStatus`, `ExcusalRequestRow`/`ExcusalRequest`/`excusalRequestFromRow` (snake→camel). TDD the mapper (extend `src/lib/types.test.ts`).
- [ ] Verify: `./dev npm run db:reset` + psql (table + RLS=t + 0 policies + partial index + `season_hours_goal` present); `./dev npm run test && lint && typecheck`. Commit `feat: excusal_request schema + types + season_hours_goal setting`. **Report: this migration must be applied to prod.**

### Task 2: Excusal-request lib + routes (TDD)

**Files:** `src/lib/excusal-requests.ts` (+test); `src/app/api/excusal-requests/route.ts`; `src/app/api/admin/requests/excusal/[id]/route.ts`.

**Interfaces:**
- `parseExcusalRequestInput(body): { date: string; reason: string | null } | null` — PURE; valid ISO `YYYY-MM-DD` date; optional bounded reason (`optString(...,500)`).
- `createExcusalRequest(personId, input, db?): { ok, status }` — inserts pending; 409 on the partial-unique violation (already a pending request for that date).
- `listPendingExcusalRequests(db?): (ExcusalRequest & { name: string })[]` — join person via the `person!person_id` FK-hint embed (avoid PGRST201; the table has two person FKs: person_id + reviewed_by).
- `listExcusalRequestsForPerson(personId, db?): ExcusalRequest[]` — newest first.
- `reviewExcusalRequest(id, decision: "approve"|"deny", reviewerId, db?): { ok, status }` — 404 miss; **guard against re-deciding** a non-pending request (409); on approve → `createExcusal({ personId, date, note: reason, createdBy: reviewerId })` then set `status='approved', reviewed_by, reviewed_at`; on deny → set `status='denied', reviewed_by, reviewed_at`.

- [ ] TDD `parseExcusalRequestInput` (accept valid; reject bad/missing date, null body) and fake-db `reviewExcusalRequest` branches (approve-creates-excusal, deny, 404, already-decided-409). Then implement.
- [ ] `POST /api/excusal-requests` — any signed-in viewer (`getViewer`; reject guest 401/403); `person_id` forced to `viewer.person.id` (NEVER from the body). Rate-limited. Returns 201 / 409 (dup) / 400 (invalid).
- [ ] `POST /api/admin/requests/excusal/[id]` — `withRole("mentor")`, body `{ action: "approve"|"deny" }`.
- [ ] Verify (lint/typecheck/test/build) + live authz after restart: anon POST `/api/excusal-requests` → 401/403; anon POST the review route → 403. Commit `feat: excusal-request library + student create/mentor review routes`.

### Task 3: Student request UI (My Attendance)

**Files:** `src/app/me/attendance/page.tsx` (modify); `src/components/ExcusalRequestForm.tsx` (create); maybe `src/components/ExcusalRequestList.tsx`.

- [ ] On My Attendance (self-scoped student page), add a "Request excusal" form (date input + optional reason) that POSTs `/api/excusal-requests`, and a list of the viewer's own requests with status **pills** (pending/approved/denied) via `listExcusalRequestsForPerson(viewer.person.id)`. The form accepts a prefilled date (query param or prop) so Task 6's "request excusal" links can target a specific missed day. Match the design system; disabled/busy state on submit; clear success/error feedback.
- [ ] Keep the page self-scoped (viewer's own id only). Verify build + `./dev npx playwright test`. Commit `feat: student excusal-request form + own-request list on My Attendance`.

### Task 4: Mentor review UI (Admin → Requests)

**Files:** `src/app/admin/requests/page.tsx` (modify); a review-action component mirroring the existing `RequestActions`.

- [ ] Add an "Excusal requests" section to the existing Admin → Requests page (mentor+ can already reach it — verify its gate is mentor+, and if it's admin-only, either relax to mentor+ for this section or add a note; match the review route's `withRole("mentor")`). List pending requests (member name, date, reason) with Approve / Deny actions hitting `/api/admin/requests/excusal/[id]`. Match the existing account-request / application queue styling.
- [ ] Verify build + `./dev npx playwright test`. Commit `feat: excusal-request review queue on Admin → Requests`.

### Task 5: Hours goal setting + math

**Files:** `src/lib/app-settings-admin.ts` (+ `season_hours_goal` in the parser/writer); `src/lib/hours.ts` or a small `src/lib/hours-goal.ts` (+test); `src/app/admin/settings/page.tsx` + `SettingsForm.tsx` (modify).

- [ ] Add `season_hours_goal` (non-negative integer; 0 = no goal) to the settings parser + `/admin/settings` form. `hoursGoalProgress(hours: number, goal: number): { goal: number; remaining: number; pct: number } | null` — PURE; returns null when goal ≤ 0; `remaining = max(0, goal - hours)`, `pct = clamp(round(hours/goal*100), 0, 100)`. TDD it.
- [ ] Verify (lint/typecheck/test/build) + jsonb round-trip of the new setting. Commit `feat: season_hours_goal setting + hoursGoalProgress helper`.

### Task 6: Nudges + E2E + docs

**Files:** `src/app/page.tsx` (dashboard), `src/app/me/attendance/page.tsx` (modify); `e2e/` (new spec); `README.md`.

- [ ] Dashboard + My Attendance: the mono `.stat` hours readout gets the goal bar (the mockup's `.stat .bar`) — "**X** of **Y** h · Z to go" — when `season_hours_goal > 0`, else just the number, using `hoursGoalProgress`. On My Attendance, show "**N** required build days missed" and, for each missed *required* day with no existing excusal (compute via `attendanceForDate`/build-days/excusals), a "Request excusal" link that prefills Task-3's form with that date.
- [ ] New Playwright spec: a student (seeded student `1741`) POSTs an excusal request; an admin/mentor approves it via the review route; assert an `excusal` now exists / the request shows approved. Self-contained from a clean `db:reset`.
- [ ] Update `README.md` (self-service excusals + hours goal). Verify: full unit + `./dev npx playwright test` + build green. Commit `feat: hours-goal + missed-day nudges, request-excusal CTAs, e2e, docs`.

## Self-review notes
- **Spec coverage (issue #28):** excusal_request model + student create (self-scoped) + mentor review→creates-excusal (Tasks 1–4); hours goal setting + nudges + request CTAs (Tasks 5–6). Both resolved decisions honored: requests allowed for past OR future dates (no date-vs-today restriction in the parser); review is `withRole("mentor")` only.
- **Safety:** student create route forces `person_id` = viewer (no acting-for-others); review is mentor+; `excusal_request` has 2 person FKs so all person embeds use the `person!person_id` hint (PGRST201); approval reuses `createExcusal` (no attendance-math changes).
- **Deferred (out of scope):** notifications/email/Slack; date-range requests; per-subteam goals; excusal-request edit history; bulk approve.
