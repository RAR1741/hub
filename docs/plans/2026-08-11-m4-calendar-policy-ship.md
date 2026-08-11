# Milestone 4: Calendar & Policy + Ship — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out v1 — Google Calendar-anchored build days, manual build days + excusals, the attendance computation and calendar grid, a student "My Attendance" view, an admin settings page, an end-to-end Playwright smoke suite, the accumulated parked-item polish, and the deploy runbook — leaving the Team Hub feature-complete and shippable by the user.

**Architecture:** Same seams as M1–M3. Pure logic (attendance status, build-day precedence, settings/parsers, the GCal service-account JWT) lives in `src/lib/` with Vitest tests. Reads happen in server components calling typed query functions (service-role `getDb()`, scoping in app code). Mutations happen in `withRole`-guarded API routes — **except** the calendar-sync route, which is dual-gated (a mentor+ session **or** a shared-secret header) so pg_cron can drive it without a session. Google Calendar access is built behind an **injectable `fetch` transport** so it is fully unit-tested against a fake payload with no network; the manual build-day path is the locally-verified one, and the real GCal round-trip is credential-gated on the user (mirrors the OAuth precedent). All day-boundary logic converts UTC through the `team_timezone` app setting using `Intl.DateTimeFormat` — no new date dependency, no browser-offset arithmetic.

**Tech Stack:** As-built: Next.js 16.3 (App Router, TS strict), Supabase (CLI 2.113 devDependency; Postgres 15 with `pg_cron` + `pg_net`), `@supabase/ssr`, `jose` (already present), Node `crypto` (built-in, for RS256), Vitest 4. **One new devDependency: `@playwright/test`.** No other new npm dependencies.

## Global Constraints (binding for every task)

- **Nothing installed on the host.** Every npm/npx/node/psql command runs inside the dev container: from the host prefix with `./dev` (e.g. `./dev npm run test`). **Git runs on the HOST** (it owns credentials). If Git Bash mangles a path argument, prefix `MSYS_NO_PATHCONV=1`.
- **Every commit is pushed immediately** (`git push` right after `git commit`).
- TypeScript strict; Node 22.
- All timestamps `timestamptz` (UTC); UUID PKs via `gen_random_uuid()`. **Store UTC everywhere; all day-boundary logic converts through the team timezone** in `app_setting` key `team_timezone` (default `"America/Indiana/Indianapolis"`). No browser-offset arithmetic.
- Roles exactly `admin`, `mentor`, `captain`, `student` (+ `guest` app-level only). Rank order (`src/lib/authz.ts`): guest < student < captain < mentor < admin.
- **RLS enabled on every new table with ZERO policies** — service-role-only access.
- Server-side Supabase always via `serverSupabaseUrl()`; auth clients share `AUTH_COOKIE_NAME` (`src/lib/supabase-cookie.ts`).
- Secrets only in `.env` / `.env.local` (both gitignored); never committed.
- **Plain semantic HTML; NO CSS frameworks.** Tailwind arrives in a separate later plan — do NOT introduce it here. A task that adds CSS-framework classes will be rejected. Color-coding uses `data-*` attributes + a small inline `<style>` block or the `style` prop only.
- db scripts: `npm run db:start | db:stop | db:reset | db:psql` (container-specific flags — do not "clean up").
- **Dev-server restart recipe** (referenced by every task that adds a NEW route/page file — Tasks 4, 5, 7, 8, 9): the app container runs `sleep infinity`; `next dev` is a manual nohup process that does NOT reliably hot-reload NEW route/page files over the Windows mount. A combined kill+start self-matches via `pkill -f` and dies, so restart with TWO SEPARATE detached execs, then poll:
  ```bash
  docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "pkill -9 -f next-server"
  sleep 4
  docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "cd /workspaces/hub && npm run dev > /tmp/nextdev.log 2>&1"
  # then poll until 200 (~15s):
  ./dev bash -lc "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/"
  ```

**Existing interfaces this milestone consumes (as-built, verified):**
- `src/lib/api.ts`: `withRole<C>(required, handler, viewerSource?)`; `[param]` routes use `type Ctx = { params: Promise<{ ... }> }`, `await context.params`. **`withRole` returns 403 BEFORE the handler runs — it cannot express the sync route's dual gate; that route is hand-rolled (Task 5).**
- `src/lib/viewer.ts`: `type Viewer = { person: Person | null; role: Role }`, `getViewer()`, `resolveViewer(deps)`. The student-token branch reads `role` from the person row (`findPersonById(claims.personId)`), so a token minted for a seeded **mentor**'s person id yields a real mentor viewer — the basis for authed E2E.
- `src/lib/authz.ts`: `hasRole(actual, required)`, `ForbiddenError`, `requireRole`.
- `src/lib/db.ts`: `getDb()` (server-only service-role client). Supports `.rpc(name, args?)`.
- `src/lib/validate.ts`: `reqString(v,max)`, `optString(v,max)` (`{value}|null`), `optInt(v,min,max)` (`{value}|null`).
- `src/lib/settings.ts`: `getSetting<T>(key, fallback, db?)`.
- `src/lib/periods.ts`: `getActivePeriod(db?)` → `Period | null` (`{ id, name, startsOn, endsOn, isActive }`), `listPeriods(db?)`.
- `src/lib/hours.ts`: `sessionHours`, `totalHours`, `sessionFlags`, `overlappingSessionIds`, `type FlagKind`.
- `src/lib/reports.ts`: `personSessions(personId, periodId, db?)`, `periodLeaderboard(periodId, db?)`, `leaderboard(rows)`, `flaggedSessions(periodId, db?)`.
- `src/lib/session-edit.ts`: `parseSessionEdit`, `parseManualSession`, `updateSession`, `deleteSession`, `createManualSession`.
- `src/lib/student-session.ts`: `STUDENT_SESSION_COOKIE = "hub_student_session"`, `createStudentSessionToken(personId, secret)` (HS256 via `jose`), `verifyStudentSessionToken(token, secret)`. **No `server-only` import — safe to import from a Playwright (Node) test.**
- `src/lib/kiosk.ts`: `KIOSK_COOKIE`, `hashKioskToken`, `verifyKioskToken`, `createKioskDevice`, `listKioskDevices`, `deleteKioskDevice`.
- `src/lib/people.ts`: `displayName(p)`, `listPeople(q?, db?)` (returns `PersonRow[]`), `canViewProfile(viewer, personId)`, `parsePersonInput`, `createPerson`, `updatePerson`.
- `src/lib/rate-limit.ts`: `createRateLimiter`, `clientIp(request)`.
- `src/lib/types.ts`: `Role`, `Person`/`PersonRow`/`personFromRow`, `Session`/`SessionRow`/`sessionFromRow`, `Period`/`PeriodRow`/`periodFromRow`, `SessionSource`.
- `src/lib/supabase-url.ts`: `serverSupabaseUrl()` reads `SUPABASE_INTERNAL_URL || NEXT_PUBLIC_SUPABASE_URL`.
- DB (M1–M3): `person`, `account_request`, `team`, `team_membership`, `period`, `session`, `kiosk_device`, `app_setting`; `close_stale_sessions()` fn + `pg_cron`; settings `team_timezone`, `auto_close_hours` (4), `max_shift_hours` (18).
- Seed (`supabase/seed.sql`): Test Student (`student_id_number='1741'`), one active period `2026–2027 Season` (`2026-08-01`..`2027-07-31`), three teams.

---

### Task 1: Playwright harness + CI E2E job + authed test-session helper

Front-loaded to de-risk the new container/CI surface. The Chromium install inside the container is the risky bit — do it first and confirm it works.

**Files:**
- Modify: `package.json` (add `@playwright/test` devDependency + `e2e` script)
- Create: `playwright.config.ts`
- Create: `e2e/helpers/session.ts`
- Create: `e2e/smoke.spec.ts`
- Modify: `supabase/seed.sql` (add a seeded mentor with a fixed UUID + `student_id_number`)
- Modify: `.github/workflows/ci.yml` (add an `e2e` job)

**Interfaces:**
- Consumes: `createStudentSessionToken` + `STUDENT_SESSION_COOKIE` (`src/lib/student-session.ts`), `STUDENT_SESSION_SECRET` env.
- Produces:
  - Seeded mentor: `person` row id `00000000-0000-0000-0000-000000000009`, role `mentor`, `student_id_number='9999'`, email `mentor@example.com`.
  - `SEEDED_MENTOR_ID: string` and `SEEDED_STUDENT_ID_NUMBER = "1741"` constants.
  - `mentorSessionCookie(baseURL?: string): Promise<{ name: string; value: string; url: string }>` — mints a valid student-session app-JWT for the seeded mentor and returns a Playwright cookie object. Later tasks (Task 11) reuse it for authed specs.

- [ ] **Step 1: Add Playwright as a devDependency and install the browser (the risky bit — do it first)**

```bash
./dev npm install -D @playwright/test@^1
./dev npx playwright install --with-deps chromium
./dev npx playwright --version   # prints a version → the install succeeded
```

If `--with-deps` fails on a missing apt package inside the container, rerun `./dev npx playwright install chromium` (browser only) and record in the report which system deps were unavailable — the smoke spec still runs headless with the bundled Chromium.

- [ ] **Step 2: Add the `e2e` npm script**

In `package.json` `scripts`, add:

```json
    "e2e": "playwright test"
```

- [ ] **Step 3: Seed a mentor with a fixed UUID (Playwright authed helper depends on it)**

Append to `supabase/seed.sql`:

```sql
-- A mentor with a fixed id and a student_id_number so E2E can mint a real
-- mentor session via the student-token branch of resolveViewer (no OAuth needed).
insert into person (id, first_name, last_name, role, student_id_number, email)
values ('00000000-0000-0000-0000-000000000009', 'Test', 'Mentor', 'mentor', '9999', 'mentor@example.com');
```

Apply and verify:

```bash
./dev npm run db:reset
./dev npm run db:psql -- -c "select id, role, is_active from person where student_id_number='9999';"
```

Expected: one row, role `mentor`, `is_active = t` (column defaults true).

- [ ] **Step 4: `playwright.config.ts`**

The dev server + Supabase are started/managed OUTSIDE Playwright (the container nohup process locally; explicit steps in CI). The config just targets the running server, chromium only.

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // specs share one DB; keep them serial
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 5: Authed-session helper `e2e/helpers/session.ts`**

```ts
import {
  STUDENT_SESSION_COOKIE,
  createStudentSessionToken,
} from "../../src/lib/student-session";

export const SEEDED_MENTOR_ID = "00000000-0000-0000-0000-000000000009";
export const SEEDED_STUDENT_ID_NUMBER = "1741";

/**
 * A Playwright cookie for a real mentor session. Mints a student-session app-JWT
 * for the seeded mentor's person id; resolveViewer reads the role (mentor) off
 * the person row, so this yields a mentor viewer without OAuth.
 */
export async function mentorSessionCookie(
  baseURL = "http://localhost:3000",
): Promise<{ name: string; value: string; url: string }> {
  const secret = process.env.STUDENT_SESSION_SECRET;
  if (!secret) throw new Error("STUDENT_SESSION_SECRET must be set for E2E");
  const value = await createStudentSessionToken(SEEDED_MENTOR_ID, secret);
  return { name: STUDENT_SESSION_COOKIE, value, url: baseURL };
}
```

- [ ] **Step 6: One trivial smoke spec `e2e/smoke.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("guest loads the home page and sees the nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Team Hub" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kiosk" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Leaderboard" })).toBeVisible();
});
```

- [ ] **Step 7: Run the smoke spec locally (dev server + supabase up)**

Ensure Supabase is up (`./dev npm run db:start`), the DB is seeded (`./dev npm run db:reset`), and the dev server is running (use the **Dev-server restart recipe** in Global Constraints). Then:

```bash
./dev bash -lc "STUDENT_SESSION_SECRET=$STUDENT_SESSION_SECRET npm run e2e"
```

Expected: `1 passed`.

- [ ] **Step 8: Add the CI `e2e` job**

`db:reset` in `package.json` hardcodes `host.docker.internal:54322`, which does NOT resolve on a Linux GitHub runner — the E2E job must run its own reset against `127.0.0.1`, and set `NEXT_PUBLIC_SUPABASE_URL` to the loopback so `serverSupabaseUrl()` resolves correctly (no `SUPABASE_INTERNAL_URL` in CI).

Add this job to `.github/workflows/ci.yml` (keep the existing `checks` job):

```yaml
  e2e:
    runs-on: ubuntu-latest
    env:
      STUDENT_SESSION_SECRET: test-e2e-secret-value
      AUTH_COOKIE_NAME: sb-teamhub-auth-token
      NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
      E2E_BASE_URL: http://localhost:3000
      # supabase/config.toml references these via env(); the CLI won't start
      # without them resolvable. Dummy values are fine — E2E uses no real OAuth.
      GOOGLE_OAUTH_CLIENT_ID: dummy
      GOOGLE_OAUTH_CLIENT_SECRET: dummy
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Start Supabase
        run: npx supabase start
      - name: Export Supabase keys into the env
        run: |
          # supabase status -o env emits ANON_KEY / SERVICE_ROLE_KEY; wire them to the app's names.
          echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(npx supabase status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '\"')" >> "$GITHUB_ENV"
          echo "SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '\"')" >> "$GITHUB_ENV"
      - name: Reset DB (loopback URL — the npm script's host.docker.internal won't resolve here)
        run: npx supabase db reset --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable --yes
      - run: npm run build
      - name: Start the app
        run: npm run start > /tmp/next.log 2>&1 &
      - name: Wait for the app
        run: npx wait-on http://localhost:3000 --timeout 60000 || (cat /tmp/next.log && exit 1)
      - run: npm run e2e
```

> Note: `npx wait-on` runs without adding a dependency (npx fetches it). If the runner blocks that, replace the wait step with a bash poll loop on `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000` until `200`.

- [ ] **Step 9: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Push, then on the HOST confirm both CI jobs pass: `gh run watch --exit-status`.

```bash
git add -A && git commit -m "test: add Playwright harness, authed-session helper, seeded mentor, and CI e2e job" && git push
```

---

### Task 2: Schema — meeting, build_day, excusal + types + settings keys

**Files:**
- Create: `supabase/migrations/<timestamp>_calendar.sql` (via `./dev npx supabase migration new calendar`)
- Modify: `src/lib/types.ts`
- Test: extend `src/lib/types.test.ts`

**Interfaces:**
- Consumes: existing `meeting`-free schema, `app_setting`, `period`.
- Produces:
  - Tables `meeting`, `build_day`, `excusal` (RLS on, zero policies). Seeded settings `gcal_calendar_id` (`""`) and `gcal_sync_secret` (`""`).
  - `type BuildDayKind = "required" | "optional"`, `type BuildDaySource = "gcal" | "manual"`
  - `type MeetingRow = { id: string; gcal_event_id: string; title: string; starts_at: string; ends_at: string; synced_at: string }`, `type Meeting = { id: string; gcalEventId: string; title: string; startsAt: string; endsAt: string; syncedAt: string }`, `meetingFromRow(row: MeetingRow): Meeting`
  - `type BuildDayRow = { date: string; kind: BuildDayKind; source: BuildDaySource; meeting_id: string | null }`, `type BuildDay = { date: string; kind: BuildDayKind; source: BuildDaySource; meetingId: string | null }`, `buildDayFromRow(row: BuildDayRow): BuildDay`
  - `type ExcusalRow = { person_id: string; date: string; note: string | null; created_by: string | null }`, `type Excusal = { personId: string; date: string; note: string | null; createdBy: string | null }`, `excusalFromRow(row: ExcusalRow): Excusal`

- [ ] **Step 1: Create the migration**

```bash
./dev npx supabase migration new calendar
```

Fill `supabase/migrations/<timestamp>_calendar.sql`:

```sql
-- Google Calendar events, upserted by the sync job (spec §4, §5). One row per event.
create table meeting (
  id uuid primary key default gen_random_uuid(),
  gcal_event_id text not null unique,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- A date the team is expected to meet. kind is STORED, not derived at query time
-- (CH's warning). source records whether the calendar sync or an admin set it:
-- a manual row wins and the sync must not overwrite it.
create table build_day (
  date date primary key,
  kind text not null default 'required' check (kind in ('required', 'optional')),
  source text not null default 'manual' check (source in ('gcal', 'manual')),
  meeting_id uuid references meeting (id) on delete set null
);

-- An excused (person, date). Shrinks the attendance denominator (CH's math).
create table excusal (
  person_id uuid not null references person (id) on delete cascade,
  date date not null,
  note text,
  created_by uuid references person (id),
  created_at timestamptz not null default now(),
  primary key (person_id, date)
);

alter table meeting enable row level security;
alter table build_day enable row level security;
alter table excusal enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).

insert into app_setting (key, value) values
  ('gcal_calendar_id', '""'),    -- the Google Calendar id to sync (empty until configured)
  ('gcal_sync_secret', '""');    -- shared secret pg_cron sends as x-sync-secret; empty = sync
                                 -- endpoint rejects the secret path (session path still works)
```

- [ ] **Step 2: Apply and verify the schema**

```bash
./dev npm run db:reset
./dev npm run db:psql -- -c "\d build_day"
./dev npm run db:psql -- -c "select key, value from app_setting order by key;"
./dev npm run db:psql -- -c "select relname, relrowsecurity from pg_class where relname in ('meeting','build_day','excusal');"
./dev npm run db:psql -- -c "select count(*) from pg_policies where tablename in ('meeting','build_day','excusal');"
./dev npm run db:psql -- -c "select conname, contype from pg_constraint where conrelid='build_day'::regclass;"
```

Expected: `build_day` has `date` PK + two check constraints; settings include `gcal_calendar_id`/`gcal_sync_secret` (both `""`); all three tables `relrowsecurity = t`; policy count `0`; `meeting.gcal_event_id` unique; `excusal` PK `(person_id, date)`.

- [ ] **Step 3: Write the failing type tests**

Append to `src/lib/types.test.ts`:

```ts
import {
  buildDayFromRow, excusalFromRow, meetingFromRow,
  type BuildDayRow, type ExcusalRow, type MeetingRow,
} from "./types";

describe("meetingFromRow", () => {
  test("maps snake_case to camelCase", () => {
    const row: MeetingRow = {
      id: "m1", gcal_event_id: "g1", title: "Build",
      starts_at: "2026-09-01T22:00:00Z", ends_at: "2026-09-02T01:00:00Z",
      synced_at: "2026-08-31T12:00:00Z",
    };
    expect(meetingFromRow(row)).toEqual({
      id: "m1", gcalEventId: "g1", title: "Build",
      startsAt: "2026-09-01T22:00:00Z", endsAt: "2026-09-02T01:00:00Z",
      syncedAt: "2026-08-31T12:00:00Z",
    });
  });
});

describe("buildDayFromRow", () => {
  test("maps all fields", () => {
    const row: BuildDayRow = { date: "2026-09-01", kind: "optional", source: "gcal", meeting_id: "m1" };
    expect(buildDayFromRow(row)).toEqual({
      date: "2026-09-01", kind: "optional", source: "gcal", meetingId: "m1",
    });
  });
});

describe("excusalFromRow", () => {
  test("maps all fields", () => {
    const row: ExcusalRow = { person_id: "p1", date: "2026-09-01", note: "sick", created_by: "p2" };
    expect(excusalFromRow(row)).toEqual({
      personId: "p1", date: "2026-09-01", note: "sick", createdBy: "p2",
    });
  });
});
```

Run: `./dev npm run test` → FAIL (exports missing).

- [ ] **Step 4: Extend `src/lib/types.ts`**

Append:

```ts
export type BuildDayKind = "required" | "optional";
export type BuildDaySource = "gcal" | "manual";

export type MeetingRow = {
  id: string;
  gcal_event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  synced_at: string;
};

export type Meeting = {
  id: string;
  gcalEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  syncedAt: string;
};

export function meetingFromRow(row: MeetingRow): Meeting {
  return {
    id: row.id,
    gcalEventId: row.gcal_event_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    syncedAt: row.synced_at,
  };
}

export type BuildDayRow = {
  date: string;
  kind: BuildDayKind;
  source: BuildDaySource;
  meeting_id: string | null;
};

export type BuildDay = {
  date: string;
  kind: BuildDayKind;
  source: BuildDaySource;
  meetingId: string | null;
};

export function buildDayFromRow(row: BuildDayRow): BuildDay {
  return {
    date: row.date,
    kind: row.kind,
    source: row.source,
    meetingId: row.meeting_id,
  };
}

export type ExcusalRow = {
  person_id: string;
  date: string;
  note: string | null;
  created_by: string | null;
};

export type Excusal = {
  personId: string;
  date: string;
  note: string | null;
  createdBy: string | null;
};

export function excusalFromRow(row: ExcusalRow): Excusal {
  return {
    personId: row.person_id,
    date: row.date,
    note: row.note,
    createdBy: row.created_by,
  };
}
```

- [ ] **Step 5: Verify + commit**

```bash
./dev npm run test && ./dev npm run lint && ./dev npm run typecheck
git add -A && git commit -m "feat: add meeting/build_day/excusal schema, settings keys, and domain types" && git push
```

---

### Task 3: Attendance computation (pure logic) — the heart, test-heavy

**Files:**
- Create: `src/lib/attendance.ts`
- Test: `src/lib/attendance.test.ts`

**Interfaces:**
- Consumes: `Session`, `BuildDay`, `Excusal`, `BuildDayKind` (`src/lib/types.ts`).
- Produces:
  - `localDateOf(iso: string, tz: string): string` — the local `YYYY-MM-DD` for a UTC instant, via `Intl.DateTimeFormat("en-CA", { timeZone })`. Shared by `sessionLocalDate` (here) and the GCal meeting→build_day mapping (Task 5).
  - `sessionLocalDate(session: Pick<Session, "timeIn">, tz: string): string` — the local date a session's `timeIn` belongs to.
  - `type AttendanceStatus = "present" | "excused" | "optional" | "absent"`
  - `attendanceForDate(personId: string, date: string, kind: BuildDayKind, sessions: Session[], excusals: Excusal[], tz: string): AttendanceStatus`
  - `type AttendanceSummary = { present: number; excused: number; optional: number; absent: number; denominator: number; percentage: number | null }`
  - `attendanceSummary(personId: string, buildDays: BuildDay[], sessions: Session[], excusals: Excusal[], tz: string): AttendanceSummary`

**Status rules (spec §4):** present if any **non-excluded** (`excludedFromTotals === false`) session for the person overlaps that local date; else excused if an excusal row exists for `(person, date)`; else `optional` if `kind === "optional"`; else `absent`. A session "overlaps local date D" iff `localDateOf(timeIn) <= D <= localDateOf(timeOut ?? timeIn)` (string compare on ISO dates — handles a session spanning local midnight without interval math).

**Denominator (excusals shrink it — CH's math), stated exactly:** over required build days only, `denominator = count of days whose status ∈ {present, absent}`, `numerator = count of days whose status === present`, `percentage = denominator === 0 ? null : round(numerator/denominator*100)` rounded to two decimals (`Math.round(x*100)/100`). **Present beats excused**, so a session on a day the person was also excused counts as `present` — in BOTH numerator and denominator. Excused required days are excluded from the denominator (that is the shrink). Optional days never contribute to numerator or denominator.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/attendance.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  attendanceForDate,
  attendanceSummary,
  localDateOf,
  sessionLocalDate,
} from "./attendance";
import type { BuildDay, Excusal, Session } from "./types";

const TZ = "America/Indiana/Indianapolis"; // US Eastern; EDT (UTC-4) in September

const session = (over: Partial<Session>): Session => ({
  id: "s", personId: "p1", periodId: "pd1",
  timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z",
  source: "kiosk", note: null, excludedFromTotals: false, editedBy: null, editedAt: null,
  ...over,
});

const bd = (date: string, kind: BuildDay["kind"] = "required"): BuildDay => ({
  date, kind, source: "gcal", meetingId: null,
});

describe("localDateOf", () => {
  test("converts a UTC instant to the team-local date", () => {
    // 03:00Z on Sep 2 is 23:00 Sep 1 in EDT (UTC-4)
    expect(localDateOf("2026-09-02T03:00:00Z", TZ)).toBe("2026-09-01");
  });
  test("handles a DST-transition day (spring forward 2026-03-08)", () => {
    // 06:30Z is 01:30 EST (UTC-5), still Mar 8 locally
    expect(localDateOf("2026-03-08T06:30:00Z", TZ)).toBe("2026-03-08");
  });
});

describe("sessionLocalDate", () => {
  test("uses time_in converted through tz", () => {
    expect(sessionLocalDate({ timeIn: "2026-09-02T03:00:00Z" }, TZ)).toBe("2026-09-01");
  });
});

describe("attendanceForDate", () => {
  test("present when a session overlaps the local date", () => {
    const s = session({ timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z" });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("present");
  });
  test("present on BOTH local dates for a session spanning local midnight", () => {
    // 03:00Z Sep 2 = 23:00 Sep 1 local; 05:00Z Sep 2 = 01:00 Sep 2 local
    const s = session({ timeIn: "2026-09-02T03:00:00Z", timeOut: "2026-09-02T05:00:00Z" });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("present");
    expect(attendanceForDate("p1", "2026-09-02", "required", [s], [], TZ)).toBe("present");
  });
  test("an excluded-from-totals session does not make the day present", () => {
    const s = session({ excludedFromTotals: true });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("absent");
  });
  test("excused when no session but an excusal row exists", () => {
    const e: Excusal = { personId: "p1", date: "2026-09-01", note: null, createdBy: "p2" };
    expect(attendanceForDate("p1", "2026-09-01", "required", [], [e], TZ)).toBe("excused");
  });
  test("optional day with no session is optional, not absent", () => {
    expect(attendanceForDate("p1", "2026-09-01", "optional", [], [], TZ)).toBe("optional");
  });
  test("absent only when required and neither present nor excused", () => {
    expect(attendanceForDate("p1", "2026-09-01", "required", [], [], TZ)).toBe("absent");
  });
  test("present beats excused (session on an excused day)", () => {
    const s = session({ timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z" });
    const e: Excusal = { personId: "p1", date: "2026-09-01", note: null, createdBy: "p2" };
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [e], TZ)).toBe("present");
  });
  test("another person's session does not count", () => {
    const s = session({ personId: "p2" });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("absent");
  });
});

describe("attendanceSummary", () => {
  test("excusals shrink the denominator; optional excluded; present-on-excused counts", () => {
    const buildDays: BuildDay[] = [
      bd("2026-09-01", "required"), // present
      bd("2026-09-02", "required"), // absent
      bd("2026-09-03", "required"), // excused → out of denominator
      bd("2026-09-04", "optional"), // optional → never counts
      bd("2026-09-05", "required"), // present (also excused, but present wins)
    ];
    const sessions: Session[] = [
      session({ id: "a", timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T20:00:00Z" }),
      session({ id: "b", timeIn: "2026-09-05T18:00:00Z", timeOut: "2026-09-05T20:00:00Z" }),
    ];
    const excusals: Excusal[] = [
      { personId: "p1", date: "2026-09-03", note: null, createdBy: "p2" },
      { personId: "p1", date: "2026-09-05", note: null, createdBy: "p2" },
    ];
    const s = attendanceSummary("p1", buildDays, sessions, excusals, TZ);
    expect(s).toEqual({
      present: 2, excused: 1, optional: 1, absent: 1,
      denominator: 3,          // 2 present + 1 absent (excused day excluded)
      percentage: 66.67,       // 2 / 3
    });
  });
  test("percentage is null when the denominator is zero", () => {
    const s = attendanceSummary("p1", [bd("2026-09-01", "optional")], [], [], TZ);
    expect(s.percentage).toBeNull();
    expect(s.denominator).toBe(0);
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/attendance.ts`**

```ts
import type { BuildDay, BuildDayKind, Excusal, Session } from "./types";

/** The team-local YYYY-MM-DD for a UTC instant. en-CA formats as YYYY-MM-DD. */
export function localDateOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** The local date a session's time_in belongs to. */
export function sessionLocalDate(session: Pick<Session, "timeIn">, tz: string): string {
  return localDateOf(session.timeIn, tz);
}

export type AttendanceStatus = "present" | "excused" | "optional" | "absent";

/** True if a non-excluded session for `personId` overlaps local date `date`. */
function isPresent(
  personId: string,
  date: string,
  sessions: Session[],
  tz: string,
): boolean {
  for (const s of sessions) {
    if (s.personId !== personId || s.excludedFromTotals) continue;
    const start = localDateOf(s.timeIn, tz);
    const end = localDateOf(s.timeOut ?? s.timeIn, tz);
    if (start <= date && date <= end) return true; // ISO-date string comparison
  }
  return false;
}

export function attendanceForDate(
  personId: string,
  date: string,
  kind: BuildDayKind,
  sessions: Session[],
  excusals: Excusal[],
  tz: string,
): AttendanceStatus {
  if (isPresent(personId, date, sessions, tz)) return "present";
  if (excusals.some((e) => e.personId === personId && e.date === date)) return "excused";
  if (kind === "optional") return "optional";
  return "absent";
}

export type AttendanceSummary = {
  present: number;
  excused: number;
  optional: number;
  absent: number;
  denominator: number;
  percentage: number | null;
};

export function attendanceSummary(
  personId: string,
  buildDays: BuildDay[],
  sessions: Session[],
  excusals: Excusal[],
  tz: string,
): AttendanceSummary {
  let present = 0;
  let excused = 0;
  let optional = 0;
  let absent = 0;
  for (const d of buildDays) {
    const status = attendanceForDate(personId, d.date, d.kind, sessions, excusals, tz);
    if (status === "present") present += 1;
    else if (status === "excused") excused += 1;
    else if (status === "optional") optional += 1;
    else absent += 1;
  }
  // Required days only; excused (and optional) excluded from the denominator.
  const denominator = present + absent;
  const percentage =
    denominator === 0 ? null : Math.round((present / denominator) * 10000) / 100;
  return { present, excused, optional, absent, denominator, percentage };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/attendance.ts src/lib/attendance.test.ts
git commit -m "feat: add timezone-aware attendance computation (pure logic)" && git push
```

---

### Task 4: Build-day + excusal libraries + manual CRUD routes

This is the VERIFIED build-day path — it works fully without Google Calendar.

**Files:**
- Create: `src/lib/build-days.ts`; Test: `src/lib/build-days.test.ts`
- Create: `src/lib/excusals.ts`; Test: `src/lib/excusals.test.ts`
- Create: `src/app/api/admin/build-days/route.ts`
- Create: `src/app/api/admin/build-days/[date]/route.ts`
- Create: `src/app/api/admin/excusals/route.ts`

**Interfaces:**
- Consumes: `withRole<C>`, `reqString`/`optString`, `getDb`, `BuildDay`/`BuildDayRow`/`buildDayFromRow`, `BuildDayKind`, `Excusal`/`ExcusalRow`/`excusalFromRow`.
- Produces:
  - `parseBuildDayInput(body): { date: string; kind: BuildDayKind } | null` — PURE; `YYYY-MM-DD` + kind in set.
  - `parseBuildDayKind(body): BuildDayKind | null` — PURE; for PATCH `{ kind }`.
  - `listBuildDays(range: { from: string; to: string }, db?): Promise<BuildDay[]>` — inclusive, ordered by date.
  - `createManualBuildDay(input: { date: string; kind: BuildDayKind }, db?): Promise<{ ok: boolean; status: number }>` — upsert by date, `source='manual'` (manual wins).
  - `setBuildDayKind(date: string, kind: BuildDayKind, db?): Promise<{ ok: boolean; status: number }>` — 404 if the date row is missing.
  - `deleteBuildDay(date: string, db?): Promise<{ ok: boolean; status: number }>`
  - `parseExcusalInput(body): { personId: string; date: string; note: string | null } | null` — PURE.
  - `listExcusals(range: { from: string; to: string }, db?): Promise<Excusal[]>`
  - `createExcusal(input: { personId: string; date: string; note: string | null }, createdBy: string, db?): Promise<{ ok: boolean; status: number }>` — upsert by `(person_id, date)`.
  - `deleteExcusal(personId: string, date: string, db?): Promise<{ ok: boolean; status: number }>`

- [ ] **Step 1: Write the failing parser tests**

Create `src/lib/build-days.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseBuildDayInput, parseBuildDayKind } from "./build-days";

describe("parseBuildDayInput", () => {
  test("accepts a valid required day", () => {
    expect(parseBuildDayInput({ date: "2026-09-01", kind: "required" })).toEqual({
      date: "2026-09-01", kind: "required",
    });
  });
  test("accepts optional", () => {
    expect(parseBuildDayInput({ date: "2026-09-01", kind: "optional" })?.kind).toBe("optional");
  });
  test.each([
    [{ date: "nope", kind: "required" }],
    [{ date: "2026-09-01", kind: "sometimes" }],
    [{ date: "2026-09-01" }],
    [{ kind: "required" }],
    [null],
  ])("rejects %j", (b) => expect(parseBuildDayInput(b)).toBeNull());
});

describe("parseBuildDayKind", () => {
  test("accepts kind", () => {
    expect(parseBuildDayKind({ kind: "optional" })).toBe("optional");
  });
  test.each([[{ kind: "nope" }], [{}], [null]])("rejects %j", (b) =>
    expect(parseBuildDayKind(b)).toBeNull(),
  );
});
```

Create `src/lib/excusals.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseExcusalInput } from "./excusals";

describe("parseExcusalInput", () => {
  test("accepts a valid excusal with a note", () => {
    expect(parseExcusalInput({ personId: "p1", date: "2026-09-01", note: " sick " })).toEqual({
      personId: "p1", date: "2026-09-01", note: "sick",
    });
  });
  test("note is optional (absent → null)", () => {
    expect(parseExcusalInput({ personId: "p1", date: "2026-09-01" })).toEqual({
      personId: "p1", date: "2026-09-01", note: null,
    });
  });
  test.each([
    [{ personId: "p1", date: "nope" }],
    [{ date: "2026-09-01" }],
    [{ personId: "p1" }],
    [null],
  ])("rejects %j", (b) => expect(parseExcusalInput(b)).toBeNull());
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/build-days.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuildDay, BuildDayKind, BuildDayRow } from "./types";
import { buildDayFromRow } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: BuildDayKind[] = ["required", "optional"];

function isValidDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
}

export type BuildDayInput = { date: string; kind: BuildDayKind };

/** Validate a manual build-day payload. PURE. */
export function parseBuildDayInput(body: unknown): BuildDayInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isValidDate(b.date)) return null;
  const kind = KINDS.find((k) => k === b.kind);
  if (!kind) return null;
  return { date: b.date, kind };
}

/** Validate a PATCH { kind } payload. PURE. */
export function parseBuildDayKind(body: unknown): BuildDayKind | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  return KINDS.find((k) => k === b.kind) ?? null;
}

export async function listBuildDays(
  range: { from: string; to: string },
  db?: SupabaseClient,
): Promise<BuildDay[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("build_day")
    .select("*")
    .gte("date", range.from)
    .lte("date", range.to)
    .order("date");
  return ((data ?? []) as BuildDayRow[]).map(buildDayFromRow);
}

/** Manual create/override: source='manual' wins over a prior gcal row. */
export async function createManualBuildDay(
  input: BuildDayInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("build_day")
    .upsert({ date: input.date, kind: input.kind, source: "manual" }, { onConflict: "date" });
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function setBuildDayKind(
  date: string,
  kind: BuildDayKind,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("build_day")
    .update({ kind })
    .eq("date", date)
    .select("date")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteBuildDay(
  date: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("build_day").delete().eq("date", date);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

- [ ] **Step 3: Implement `src/lib/excusals.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Excusal, ExcusalRow } from "./types";
import { excusalFromRow } from "./types";
import { optString, reqString } from "./validate";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ExcusalInput = { personId: string; date: string; note: string | null };

/** Validate an excusal payload. PURE. */
export function parseExcusalInput(body: unknown): ExcusalInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const personId = reqString(b.personId, 64);
  const date = typeof b.date === "string" && ISO_DATE.test(b.date) && !Number.isNaN(Date.parse(b.date))
    ? b.date
    : null;
  const note = optString(b.note, 500);
  if (!personId || !date || !note) return null;
  return { personId, date, note: note.value };
}

export async function listExcusals(
  range: { from: string; to: string },
  db?: SupabaseClient,
): Promise<Excusal[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("excusal")
    .select("*")
    .gte("date", range.from)
    .lte("date", range.to)
    .order("date");
  return ((data ?? []) as ExcusalRow[]).map(excusalFromRow);
}

export async function createExcusal(
  input: ExcusalInput,
  createdBy: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("excusal")
    .upsert(
      { person_id: input.personId, date: input.date, note: input.note, created_by: createdBy },
      { onConflict: "person_id,date" },
    );
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function deleteExcusal(
  personId: string,
  date: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("excusal")
    .delete()
    .eq("person_id", personId)
    .eq("date", date);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 4: Build-day routes**

Create `src/app/api/admin/build-days/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createManualBuildDay, parseBuildDayInput } from "@/lib/build-days";

export const POST = withRole("mentor", async (_viewer, request) => {
  const input = parseBuildDayInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createManualBuildDay(input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

Create `src/app/api/admin/build-days/[date]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { deleteBuildDay, parseBuildDayKind, setBuildDayKind } from "@/lib/build-days";

type Ctx = { params: Promise<{ date: string }> };

export const PATCH = withRole<Ctx>("mentor", async (_viewer, request, context) => {
  const { date } = await context.params;
  const kind = parseBuildDayKind(await request.json().catch(() => null));
  if (!kind) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await setBuildDayKind(date, kind);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { date } = await context.params;
  const result = await deleteBuildDay(date);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 5: Excusal route**

Excusals have a composite key, so DELETE takes the pair in the body (not the path).

Create `src/app/api/admin/excusals/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createExcusal, deleteExcusal, parseExcusalInput } from "@/lib/excusals";
import { reqString } from "@/lib/validate";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseExcusalInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createExcusal(input, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole("mentor", async (_viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = reqString(body?.personId, 64);
  const date = typeof body?.date === "string" ? body.date : null;
  if (!personId || !date) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteExcusal(personId, date);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 6: Verify + live authz**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Restart the dev server (Global Constraints recipe), then:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/build-days -H 'Content-Type: application/json' -d '{}'"   # 403 anonymous
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/excusals -H 'Content-Type: application/json' -d '{}'"      # 403 anonymous
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add build-day and excusal libraries and manual CRUD routes" && git push
```

---

### Task 5: Google Calendar sync library (injectable fetch) + "Sync now" route + setup doc

**Files:**
- Create: `src/lib/gcal.ts`; Test: `src/lib/gcal.test.ts`
- Create: `src/app/api/admin/calendar/sync/route.ts`
- Create: `docs/setup/google-calendar.md`

**Interfaces:**
- Consumes: `getDb`, `getSetting`, `getViewer`, `hasRole`, `localDateOf` (Task 3), `Meeting`-related tables (Task 2).
- Produces:
  - `type GcalTransport = typeof globalThis.fetch` — the single injected seam.
  - `type GcalCredentials = { clientEmail: string; privateKey: string; calendarId: string }`
  - `gcalCredentialsFromEnv(calendarId: string): GcalCredentials | null` — reads `GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` from env; null if either is missing or `calendarId` is empty.
  - `buildServiceAccountJwt(creds: Pick<GcalCredentials, "clientEmail" | "privateKey">, now?: () => number): string` — RS256 (`crypto.createSign("RSA-SHA256")`), audience `https://oauth2.googleapis.com/token`, scope `calendar.readonly`.
  - `type GcalDeps = { fetch: GcalTransport; db: SupabaseClient; credentials: GcalCredentials; tz: string; now?: () => number }`
  - `type SyncResult = { meetings: number; buildDays: number }`
  - `syncCalendar(deps: GcalDeps): Promise<SyncResult>` — exchanges the JWT for an access token, GETs events, upserts `meeting` (by `gcal_event_id`), and marks each meeting's local start date as a `build_day` (default `kind='required'`, `source='gcal'`, **ignoring existing rows** so manual/admin overrides survive).

- [ ] **Step 1: Write the failing test (fake transport + fake db — no network)**

Create `src/lib/gcal.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildServiceAccountJwt, syncCalendar, type GcalTransport } from "./gcal";
import { generateKeyPairSync } from "node:crypto";

// A throwaway RSA key so buildServiceAccountJwt can actually sign in the test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("buildServiceAccountJwt", () => {
  test("produces a three-segment JWT", () => {
    const jwt = buildServiceAccountJwt(
      { clientEmail: "svc@proj.iam.gserviceaccount.com", privateKey: PEM },
      () => 1_700_000_000_000,
    );
    expect(jwt.split(".")).toHaveLength(3);
  });
});

// Captures upsert calls per table so we can assert what sync wrote.
function fakeDb() {
  const calls: { table: string; rows: unknown; opts: unknown }[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        return {
          upsert: async (rows: unknown, opts: unknown) => {
            calls.push({ table, rows, opts });
            return { error: null };
          },
        };
      },
    } as never,
  };
}

// Dispatches on URL: token endpoint vs events endpoint.
function fakeFetch(events: unknown[]): GcalTransport {
  return (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (href.includes("/calendar/v3/calendars/")) {
      return new Response(JSON.stringify({ items: events }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${href}`);
  }) as unknown as GcalTransport;
}

describe("syncCalendar", () => {
  test("upserts meetings by gcal_event_id and marks build days (gcal, ignore existing)", async () => {
    const db = fakeDb();
    const events = [
      {
        id: "evt-1",
        summary: "Build Session",
        start: { dateTime: "2026-09-02T03:00:00Z" }, // 23:00 Sep 1 local (EDT)
        end: { dateTime: "2026-09-02T05:00:00Z" },
      },
    ];
    const result = await syncCalendar({
      fetch: fakeFetch(events),
      db: db.client,
      credentials: {
        clientEmail: "svc@proj.iam.gserviceaccount.com",
        privateKey: PEM,
        calendarId: "team@group.calendar.google.com",
      },
      tz: "America/Indiana/Indianapolis",
      now: () => 1_700_000_000_000,
    });

    expect(result).toEqual({ meetings: 1, buildDays: 1 });

    const meetingCall = db.calls.find((c) => c.table === "meeting")!;
    expect(meetingCall.opts).toEqual({ onConflict: "gcal_event_id" });
    expect(meetingCall.rows).toMatchObject([
      { gcal_event_id: "evt-1", title: "Build Session" },
    ]);

    const buildDayCall = db.calls.find((c) => c.table === "build_day")!;
    expect(buildDayCall.opts).toEqual({ onConflict: "date", ignoreDuplicates: true });
    expect(buildDayCall.rows).toEqual([
      { date: "2026-09-01", kind: "required", source: "gcal" }, // local start date
    ]);
  });

  test("no events → no upserts", async () => {
    const db = fakeDb();
    const result = await syncCalendar({
      fetch: fakeFetch([]),
      db: db.client,
      credentials: { clientEmail: "svc@x", privateKey: PEM, calendarId: "c" },
      tz: "America/Indiana/Indianapolis",
      now: () => 1_700_000_000_000,
    });
    expect(result).toEqual({ meetings: 0, buildDays: 0 });
    expect(db.calls).toHaveLength(0);
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/gcal.ts`**

```ts
import { createSign } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateOf } from "./attendance";

export type GcalTransport = typeof globalThis.fetch;

export type GcalCredentials = {
  clientEmail: string;
  privateKey: string;
  calendarId: string;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Read service-account creds from env; null if not fully configured. */
export function gcalCredentialsFromEnv(calendarId: string): GcalCredentials | null {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  // Private keys in env keep literal "\n"; restore real newlines for the PEM parser.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey || !calendarId) return null;
  return { clientEmail, privateKey, calendarId };
}

/** Signed RS256 service-account assertion for the token exchange. */
export function buildServiceAccountJwt(
  creds: Pick<GcalCredentials, "clientEmail" | "privateKey">,
  now: () => number = Date.now,
): string {
  const iat = Math.floor(now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(creds.privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

async function fetchAccessToken(deps: GcalDeps): Promise<string> {
  const assertion = buildServiceAccountJwt(deps.credentials, deps.now);
  const res = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token exchange returned no access_token");
  return json.access_token;
}

type GcalEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export type GcalDeps = {
  fetch: GcalTransport;
  db: SupabaseClient;
  credentials: GcalCredentials;
  tz: string;
  now?: () => number;
};

export type SyncResult = { meetings: number; buildDays: number };

export async function syncCalendar(deps: GcalDeps): Promise<SyncResult> {
  const token = await fetchAccessToken(deps);
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      deps.credentials.calendarId,
    )}/events`,
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const res = await deps.fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
  const json = (await res.json()) as { items?: GcalEvent[] };
  const events = (json.items ?? []).filter((e) => e.id && (e.start?.dateTime || e.start?.date));
  if (events.length === 0) return { meetings: 0, buildDays: 0 };

  const syncedAt = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const meetingRows = events.map((e) => {
    const startsAt = e.start!.dateTime ?? `${e.start!.date}T00:00:00Z`;
    let endsAt: string;
    if (e.end?.dateTime) endsAt = e.end.dateTime;
    else if (e.end?.date) endsAt = `${e.end.date}T00:00:00Z`;
    else endsAt = startsAt;
    return {
      gcal_event_id: e.id,
      title: e.summary ?? "(untitled)",
      starts_at: startsAt,
      ends_at: endsAt,
      synced_at: syncedAt,
    };
  });
  const { error: meetingError } = await deps.db
    .from("meeting")
    .upsert(meetingRows, { onConflict: "gcal_event_id" });
  if (meetingError) throw new Error(`meeting upsert failed: ${meetingError.message}`);

  // One build_day per distinct local start date; never overwrite an existing row.
  const dates = [...new Set(meetingRows.map((m) => localDateOf(m.starts_at, deps.tz)))];
  const buildDayRows = dates.map((date) => ({ date, kind: "required", source: "gcal" }));
  const { error: bdError } = await deps.db
    .from("build_day")
    .upsert(buildDayRows, { onConflict: "date", ignoreDuplicates: true });
  if (bdError) throw new Error(`build_day upsert failed: ${bdError.message}`);

  return { meetings: meetingRows.length, buildDays: buildDayRows.length };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Dual-gated sync route `src/app/api/admin/calendar/sync/route.ts`**

`withRole` 403s before the handler runs, so it cannot express the shared-secret path. Hand-roll the gate: shared secret first (must be non-empty AND match — an empty stored secret must NOT authorize anyone), else a mentor+ session.

```ts
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { gcalCredentialsFromEnv, syncCalendar } from "@/lib/gcal";

export async function POST(request: Request) {
  const db = getDb();

  // Gate 1: shared secret (for pg_cron, which has no session). Empty secret never authorizes.
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("gcal_sync_secret", "", db);
  const secretOk = secret.length > 0 && provided === secret;

  // Gate 2: a mentor+ session.
  if (!secretOk) {
    const viewer = await getViewer();
    if (!hasRole(viewer.role, "mentor")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const calendarId = await getSetting<string>("gcal_calendar_id", "", db);
  const credentials = gcalCredentialsFromEnv(calendarId);
  if (!credentials) return Response.json({ error: "not_configured" }, { status: 400 });

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis", db);
  try {
    const result = await syncCalendar({ fetch: globalThis.fetch, db, credentials, tz });
    return Response.json(result);
  } catch {
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Setup doc `docs/setup/google-calendar.md`**

Model it on `docs/setup/google-oauth.md` (same "you drive; code is wired" framing). It must cover, at minimum:

- **What it does:** an hourly pg_cron job POSTs the sync endpoint, which pulls read-only events from one Google Calendar into `meeting` and marks their dates as build days (default `required`; admins flip to `optional` or add manual days in the UI — so the app works before the calendar is connected).
- **Create a service account:** Google Cloud Console → the same project as OAuth → **APIs & Services → Enable the Google Calendar API** → **Credentials → Create credentials → Service account** → create a JSON key → download it.
- **Share the calendar:** in Google Calendar settings for the team calendar → **Share with specific people** → add the service account's email with **See all event details** (read-only). Copy the calendar's **Calendar ID** (Settings → Integrate calendar).
- **Where values live** (a table, like the OAuth doc):
  | Variable | File | Read by |
  |---|---|---|
  | `GOOGLE_SA_CLIENT_EMAIL` | `.env.local` | the Next.js app (sync route) |
  | `GOOGLE_SA_PRIVATE_KEY` | `.env.local` | the Next.js app (RS256 assertion) |
  | `gcal_calendar_id` | `app_setting` (Admin → Settings) | the sync route |
  | `gcal_sync_secret` | `app_setting` (set via SQL / deploy runbook) | the sync route's shared-secret gate + pg_cron |
  Note the private key spans multiple lines: paste it with literal `\n` escapes on one line (the code restores newlines), or keep real newlines quoted.
- **Trigger a sync manually:** `POST /api/admin/calendar/sync` while signed in as a mentor+ (or with the `x-sync-secret` header). Explain the hourly pg_cron schedule (Task 6) and that setting `gcal_sync_secret` (non-empty) is what lets cron authenticate.
- **Local vs credential-gated:** state that the manual build-day path (Task 4) is the locally-verified one; the GCal end-to-end round-trip is gated on the user creating the service account and sharing the calendar (mirrors the OAuth precedent — not performed autonomously).

- [ ] **Step 5: Verify + live authz (no creds needed — expect not_configured/forbidden)**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Restart the dev server (Global Constraints recipe), then:

```bash
# Anonymous, no secret → 403 (session gate fails; secret is empty so that path is closed).
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/calendar/sync"   # 403
# Wrong secret while it's empty → still 403 (empty stored secret never authorizes).
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/calendar/sync -H 'x-sync-secret: anything'"   # 403
```

Then confirm the secret gate opens only when configured AND matched, and that a matched secret with no creds returns `not_configured` (400), proving the gate passed:

```bash
./dev npm run db:psql -- -c "update app_setting set value = '\"s3cret\"' where key='gcal_sync_secret';"
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/calendar/sync -H 'x-sync-secret: s3cret'"   # 400 not_configured (gate passed; no SA creds)
./dev npm run db:psql -- -c "update app_setting set value = '\"\"' where key='gcal_sync_secret';"
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Google Calendar sync (injectable fetch), dual-gated sync route, setup doc" && git push
```

---

### Task 6: pg_cron + pg_net scheduled hourly sync (tolerated-if-unavailable locally)

Follow the M3-Task-8 caveat pattern exactly: if `pg_net`/`pg_cron` or the schedule errors in the local stack, comment ONLY the extension + schedule lines, keep everything else, and record it in the report — the schedule applies on the hosted project (documented in the Task 12 deploy runbook).

**Files:**
- Create: `supabase/migrations/<timestamp>_calendar_cron.sql` (via `./dev npx supabase migration new calendar_cron`)
- Modify: `supabase/README.md` (document the hourly sync job)

**Interfaces:**
- Consumes: `pg_cron` (already enabled in M3), `pg_net`, `app_setting` keys `sync_url` + `gcal_sync_secret`, the `POST /api/admin/calendar/sync` route (Task 5).
- Produces: `app_setting` key `sync_url`; a pg_cron job `gcal-hourly-sync` that `net.http_post`s the sync endpoint with the `x-sync-secret` header, reading both values from `app_setting` at run time.

- [ ] **Step 1: Create the migration**

```bash
./dev npx supabase migration new calendar_cron
```

Fill `supabase/migrations/<timestamp>_calendar_cron.sql`:

```sql
-- Hourly Google Calendar sync via pg_net → the app's sync endpoint. The endpoint
-- authenticates cron by the x-sync-secret header (matched against app_setting
-- gcal_sync_secret). URL + secret are read from app_setting AT RUN TIME via
-- sub-selects, so changing them (e.g. to the production URL) needs no new migration.
--
-- Locally, sync_url points at the app on the host. Set it to the production URL on
-- the hosted project (see docs/setup/deploy.md).
insert into app_setting (key, value) values
  ('sync_url', '"http://host.docker.internal:3000/api/admin/calendar/sync"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'gcal-hourly-sync',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'gcal_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

**Local availability note:** the Supabase local image bundles `pg_cron` (used in M3) and usually `pg_net`. If `create extension pg_net` or `cron.schedule` errors in the local stack, comment out ONLY those two statements (the `create extension` and the `select cron.schedule(...)`), keep the `insert ... sync_url`, and record it in the report — the schedule applies on the hosted project (Task 12). Do NOT remove the `sync_url` seed.

- [ ] **Step 2: Apply and verify**

```bash
./dev npm run db:reset
./dev npm run db:psql -- -c "select value from app_setting where key='sync_url';"
./dev npm run db:psql -- -c "select extname from pg_extension where extname in ('pg_cron','pg_net');"
./dev npm run db:psql -- -c "select jobname, schedule from cron.job where jobname='gcal-hourly-sync';" 2>&1 | tail -3
```

Expected: `sync_url` present; `pg_cron` (and ideally `pg_net`) listed; the `gcal-hourly-sync` job present. If `pg_net` is missing locally, confirm the commented-out state applied cleanly (reset succeeds) and note it in the report.

- [ ] **Step 3: Document in `supabase/README.md`**

Add a short "Hourly calendar sync" section: what the `gcal-hourly-sync` pg_cron job does, that it POSTs `sync_url` with the `x-sync-secret` header read from `app_setting` at run time, that the sync endpoint is a no-op returning `not_configured` until the service account is set up, and that on the hosted project `sync_url` must be updated to the production URL and `gcal_sync_secret` set to a non-empty value (cross-link `docs/setup/google-calendar.md` and `docs/setup/deploy.md`).

- [ ] **Step 4: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test
git add -A && git commit -m "feat: add hourly pg_cron+pg_net calendar-sync schedule" && git push
```

---

### Task 7: `/calendar` attendance grid (mentor+)

CH's grid: rows = active members, columns = build days across the active period's range, cells color-coded present/excused/optional/absent, per-member attendance %, cell actions to add a session and to excuse.

**Files:**
- Modify: `src/lib/reports.ts` (add `sessionsForPeriod`); Test: extend `src/lib/reports.test.ts`
- Create: `src/app/calendar/page.tsx`
- Create: `src/components/AttendanceGridActions.tsx`

**Interfaces:**
- Consumes: `getViewer`, `hasRole`, `getActivePeriod`, `listBuildDays` (Task 4), `listExcusals` (Task 4), `listPeople` (people), `displayName`, `attendanceForDate`/`attendanceSummary` (Task 3), `getSetting` (`team_timezone`), existing M3 `/api/admin/sessions` (manual add) + Task 4 `/api/admin/excusals`.
- Produces:
  - `sessionsForPeriod(periodId: string, db?): Promise<Session[]>` — all sessions in a period (raw, all people), for grid + summary computation.

- [ ] **Step 1: Write the failing test for `sessionsForPeriod` (fake db)**

Append to `src/lib/reports.test.ts`:

```ts
import { sessionsForPeriod } from "./reports";

describe("sessionsForPeriod", () => {
  test("maps rows to Session[]", async () => {
    const rows = [
      {
        id: "s1", person_id: "p1", period_id: "pd1",
        time_in: "2026-09-01T18:00:00Z", time_out: "2026-09-01T20:00:00Z",
        source: "kiosk", note: null, excluded_from_totals: false, edited_by: null, edited_at: null,
      },
    ];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ order: async () => ({ data: rows, error: null }) }),
        }),
      }),
    } as never;
    const result = await sessionsForPeriod("pd1", db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "s1", personId: "p1", timeIn: "2026-09-01T18:00:00Z" });
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Add `sessionsForPeriod` to `src/lib/reports.ts`**

Append:

```ts
/** All sessions in a period (raw, all people) — for the attendance grid. */
export async function sessionsForPeriod(
  periodId: string,
  db?: SupabaseClient,
): Promise<Session[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("session")
    .select("*")
    .eq("period_id", periodId)
    .order("time_in");
  return ((data ?? []) as SessionRow[]).map(sessionFromRow);
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Grid cell-actions client component `src/components/AttendanceGridActions.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "present" | "excused" | "optional" | "absent";

/**
 * A single grid cell: shows the color-coded status and, on click, offers to add
 * a manual session (mark present) or toggle an excusal for (person, date).
 */
export function AttendanceCell({
  personId,
  date,
  status,
}: {
  personId: string;
  date: string;
  status: Status;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function addSession() {
    if (busy) return;
    setBusy(true);
    // A default 2-hour session at local noon UTC-ish; mentor refines on the flagged screen.
    const res = await fetch("/api/admin/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        timeIn: `${date}T17:00:00Z`,
        timeOut: `${date}T19:00:00Z`,
        note: "added from calendar",
      }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function toggleExcusal() {
    if (busy) return;
    setBusy(true);
    const method = status === "excused" ? "DELETE" : "POST";
    const res = await fetch("/api/admin/excusals", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId, date, note: "excused from calendar" }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <td data-status={status} title={`${date}: ${status}`}>
      <span className="dot" aria-label={status} />
      <span className="cell-actions">
        <button type="button" disabled={busy} onClick={addSession}>+ session</button>
        <button type="button" disabled={busy} onClick={toggleExcusal}>
          {status === "excused" ? "unexcuse" : "excuse"}
        </button>
      </span>
    </td>
  );
}
```

- [ ] **Step 4: Grid page `src/app/calendar/page.tsx`**

Color-coding is via `data-status` + a small inline `<style>` (no CSS framework). Server component gated mentor+.

```tsx
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { listBuildDays } from "@/lib/build-days";
import { listExcusals } from "@/lib/excusals";
import { sessionsForPeriod } from "@/lib/reports";
import { listPeople, displayName } from "@/lib/people";
import { getSetting } from "@/lib/settings";
import { attendanceForDate, attendanceSummary } from "@/lib/attendance";
import { AttendanceCell } from "@/components/AttendanceGridActions";

export default async function CalendarPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const period = await getActivePeriod();
  if (!period) {
    return (
      <main>
        <h1>Calendar</h1>
        <p>No active period. Create one in Admin → Periods.</p>
      </main>
    );
  }

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis");
  const range = { from: period.startsOn, to: period.endsOn };
  const [buildDays, excusals, sessions, peopleRows] = await Promise.all([
    listBuildDays(range),
    listExcusals(range),
    sessionsForPeriod(period.id),
    listPeople(),
  ]);
  const members = peopleRows
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main>
      <style>{`
        .grid { border-collapse: collapse; }
        .grid td, .grid th { border: 1px solid #ccc; padding: 2px 4px; font-size: 12px; }
        .grid td[data-status] .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
        .grid td[data-status="present"] .dot { background: #2e7d32; }
        .grid td[data-status="excused"] .dot { background: #f9a825; }
        .grid td[data-status="optional"] .dot { background: #90caf9; }
        .grid td[data-status="absent"] .dot { background: #c62828; }
        .grid .cell-actions { display: none; }
        .grid td:hover .cell-actions { display: inline; }
      `}</style>
      <h1>Calendar — {period.name}</h1>
      {buildDays.length === 0 ? (
        <p>No build days yet. Add them in Admin (build-days API) or connect Google Calendar.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Member</th>
                <th>%</th>
                {buildDays.map((d) => (
                  <th key={d.date}>{d.date.slice(5)}{d.kind === "optional" ? "*" : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const summary = attendanceSummary(m.id, buildDays, sessions, excusals, tz);
                return (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{summary.percentage === null ? "—" : `${summary.percentage}%`}</td>
                    {buildDays.map((d) => (
                      <AttendanceCell
                        key={d.date}
                        personId={m.id}
                        date={d.date}
                        status={attendanceForDate(m.id, d.date, d.kind, sessions, excusals, tz)}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p><small>* optional day. Green present · amber excused · blue optional · red absent. Hover a cell for actions.</small></p>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify + live gate**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Restart the dev server (Global Constraints recipe), then:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/calendar"   # 307 (guest redirected to /)
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add /calendar attendance grid (mentor+)" && git push
```

---

### Task 8: `/me/attendance` (student) + dashboard upcoming meetings

**Files:**
- Create: `src/lib/meetings.ts`; Test: `src/lib/meetings.test.ts`
- Create: `src/app/me/attendance/page.tsx`
- Modify: `src/app/page.tsx` (add an "Upcoming meetings" section)

**Interfaces:**
- Consumes: `getViewer`, `getActivePeriod`, `listBuildDays` (Task 4), `listExcusals` (Task 4), `personSessions` (reports), `attendanceForDate`/`attendanceSummary` (Task 3), `getSetting`, `Meeting`/`meetingFromRow` (Task 2).
- Produces:
  - `listUpcomingMeetings(nowIso: string, limit: number, db?): Promise<Meeting[]>` — meetings with `starts_at >= now`, ascending, capped at `limit`.

- [ ] **Step 1: Write the failing test for `listUpcomingMeetings` (fake db)**

Create `src/lib/meetings.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { listUpcomingMeetings } from "./meetings";

describe("listUpcomingMeetings", () => {
  test("passes the now filter + limit and maps rows", async () => {
    const captured: Record<string, unknown> = {};
    const rows = [
      {
        id: "m1", gcal_event_id: "g1", title: "Build",
        starts_at: "2026-09-02T22:00:00Z", ends_at: "2026-09-03T01:00:00Z",
        synced_at: "2026-08-31T00:00:00Z",
      },
    ];
    const db = {
      from: () => ({
        select: () => ({
          gte: (_col: string, val: string) => {
            captured.gte = val;
            return {
              order: () => ({
                limit: (n: number) => {
                  captured.limit = n;
                  return Promise.resolve({ data: rows, error: null });
                },
              }),
            };
          },
        }),
      }),
    } as never;
    const result = await listUpcomingMeetings("2026-09-01T00:00:00Z", 5, db);
    expect(captured.gte).toBe("2026-09-01T00:00:00Z");
    expect(captured.limit).toBe(5);
    expect(result[0]).toMatchObject({ id: "m1", gcalEventId: "g1", title: "Build" });
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/meetings.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meeting, MeetingRow } from "./types";
import { meetingFromRow } from "./types";

export async function listUpcomingMeetings(
  nowIso: string,
  limit: number,
  db?: SupabaseClient,
): Promise<Meeting[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("meeting")
    .select("*")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(limit);
  return ((data ?? []) as MeetingRow[]).map(meetingFromRow);
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: `/me/attendance` page `src/app/me/attendance/page.tsx`**

Self-scoped to the signed-in student. Handle the guest and no-active-period cases.

```tsx
import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { getActivePeriod } from "@/lib/periods";
import { listBuildDays } from "@/lib/build-days";
import { listExcusals } from "@/lib/excusals";
import { personSessions } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { attendanceForDate, attendanceSummary } from "@/lib/attendance";

export default async function MyAttendancePage() {
  const viewer = await getViewer();
  if (!viewer.person) {
    return (
      <main>
        <h1>My Attendance</h1>
        <p>Please <Link href="/login">sign in</Link> to see your attendance.</p>
      </main>
    );
  }

  const period = await getActivePeriod();
  if (!period) {
    return (
      <main>
        <h1>My Attendance</h1>
        <p>No active period yet.</p>
      </main>
    );
  }

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis");
  const range = { from: period.startsOn, to: period.endsOn };
  const personId = viewer.person.id;
  const [buildDays, allExcusals, sessions] = await Promise.all([
    listBuildDays(range),
    listExcusals(range),
    personSessions(personId, period.id),
  ]);
  const excusals = allExcusals.filter((e) => e.personId === personId);
  const summary = attendanceSummary(personId, buildDays, sessions, excusals, tz);

  return (
    <main>
      <h1>My Attendance — {period.name}</h1>
      <p>
        Attendance: <strong>{summary.percentage === null ? "—" : `${summary.percentage}%`}</strong>
        {" "}({summary.present} present, {summary.excused} excused, {summary.absent} absent,
        {" "}{summary.optional} optional)
      </p>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>
          {buildDays.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.kind}</td>
              <td>{attendanceForDate(personId, d.date, d.kind, sessions, excusals, tz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 4: Add "Upcoming meetings" to `src/app/page.tsx`**

Per the milestone task decomposition, show upcoming meetings to **signed-in viewers** (the prompt binds; note the divergence from spec §8's guest-scope "meeting schedule" in Self-review). Add the import and a fetch, then render inside the signed-in branch.

Add to the imports:

```tsx
import { listUpcomingMeetings } from "@/lib/meetings";
```

Inside `HomePage()`, after the existing `myHours` computation, add:

```tsx
const upcoming = viewer.person
  ? await listUpcomingMeetings(new Date().toISOString(), 5)
  : [];
```

In the signed-in JSX branch, after `<WhosHere ... />`, add:

```tsx
<section>
  <h2>Upcoming meetings</h2>
  {upcoming.length === 0 ? (
    <p>No upcoming meetings scheduled.</p>
  ) : (
    <ul>
      {upcoming.map((m) => (
        <li key={m.id}>
          {new Date(m.startsAt).toLocaleString()} — {m.title}
        </li>
      ))}
    </ul>
  )}
</section>
```

- [ ] **Step 5: Verify + live**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Restart the dev server (Global Constraints recipe), then:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/me/attendance"   # 200 (renders the sign-in prompt for a guest)
./dev bash -lc "curl -s http://localhost:3000/me/attendance | grep -o 'My Attendance'"           # present
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add /me/attendance and dashboard upcoming-meetings section" && git push
```

---

### Task 9: `/admin/settings` page (admin)

**Files:**
- Create: `src/lib/app-settings-admin.ts`; Test: `src/lib/app-settings-admin.test.ts`
- Create: `src/app/api/admin/settings/route.ts`
- Create: `src/components/SettingsForm.tsx`
- Create: `src/app/admin/settings/page.tsx`
- Modify: `src/components/SiteNav.tsx` (add the Admin: Settings link)

**Interfaces:**
- Consumes: `withRole`, `getDb`, `getSetting`, `getViewer`, `hasRole`.
- Produces:
  - `type SettingsInput = { teamTimezone: string; gcalCalendarId: string; autoCloseHours: number; maxShiftHours: number }`
  - `parseSettingsInput(body): SettingsInput | null` — PURE; validates the timezone via `Intl` (a bad zone throws → null), `gcalCalendarId` ≤ 200 chars (empty allowed), `autoCloseHours` 1..24, `maxShiftHours` 1..48.
  - `setSettings(input: SettingsInput, db?): Promise<{ ok: boolean; status: number }>` — upserts the four `app_setting` keys.

- [ ] **Step 1: Write the failing parser tests**

Create `src/lib/app-settings-admin.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseSettingsInput } from "./app-settings-admin";

describe("parseSettingsInput", () => {
  test("accepts a valid payload (empty calendar id allowed)", () => {
    expect(
      parseSettingsInput({
        teamTimezone: "America/Indiana/Indianapolis",
        gcalCalendarId: "",
        autoCloseHours: 4,
        maxShiftHours: 18,
      }),
    ).toEqual({
      teamTimezone: "America/Indiana/Indianapolis",
      gcalCalendarId: "",
      autoCloseHours: 4,
      maxShiftHours: 18,
    });
  });
  test.each([
    [{ teamTimezone: "Not/AZone", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 18 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 0, maxShiftHours: 18 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 99 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "x".repeat(201), autoCloseHours: 4, maxShiftHours: 18 }],
    [null],
  ])("rejects %j", (b) => expect(parseSettingsInput(b)).toBeNull());
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/app-settings-admin.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type SettingsInput = {
  teamTimezone: string;
  gcalCalendarId: string;
  autoCloseHours: number;
  maxShiftHours: number;
};

function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function intInRange(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

/** Validate the admin settings payload. PURE. */
export function parseSettingsInput(body: unknown): SettingsInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isValidTimeZone(b.teamTimezone)) return null;
  const gcalCalendarId = typeof b.gcalCalendarId === "string" ? b.gcalCalendarId.trim() : null;
  if (gcalCalendarId === null || gcalCalendarId.length > 200) return null;
  const autoCloseHours = intInRange(b.autoCloseHours, 1, 24);
  const maxShiftHours = intInRange(b.maxShiftHours, 1, 48);
  if (autoCloseHours === null || maxShiftHours === null) return null;
  return { teamTimezone: b.teamTimezone, gcalCalendarId, autoCloseHours, maxShiftHours };
}

export async function setSettings(
  input: SettingsInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const rows = [
    { key: "team_timezone", value: input.teamTimezone },
    { key: "gcal_calendar_id", value: input.gcalCalendarId },
    { key: "auto_close_hours", value: input.autoCloseHours },
    { key: "max_shift_hours", value: input.maxShiftHours },
  ];
  const { error } = await client.from("app_setting").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

> Note: `app_setting.value` is `jsonb`; supabase-js serializes a JS string/number to the correct JSON scalar, matching how `getSetting<T>` reads them (`team_timezone` as a JSON string, the hour settings as JSON numbers).

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Route `src/app/api/admin/settings/route.ts`**

```ts
import { withRole } from "@/lib/api";
import { parseSettingsInput, setSettings } from "@/lib/app-settings-admin";

export const PATCH = withRole("admin", async (_viewer, request) => {
  const input = parseSettingsInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await setSettings(input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 4: Settings form `src/components/SettingsForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SettingsValues = {
  teamTimezone: string;
  gcalCalendarId: string;
  autoCloseHours: number;
  maxShiftHours: number;
};

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const [values, setValues] = useState<SettingsValues>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) { setStatus("Saved."); router.refresh(); }
    else if (res.status === 400) setStatus("Check the fields (timezone must be a valid IANA zone; hours in range).");
    else setStatus("Save failed.");
  }

  return (
    <form onSubmit={submit}>
      <label>Team timezone{" "}
        <input value={values.teamTimezone}
          onChange={(e) => setValues({ ...values, teamTimezone: e.target.value })} required />
      </label>
      <label>Google Calendar id{" "}
        <input value={values.gcalCalendarId}
          onChange={(e) => setValues({ ...values, gcalCalendarId: e.target.value })} />
      </label>
      <label>Auto-close hours{" "}
        <input type="number" min={1} max={24} value={values.autoCloseHours}
          onChange={(e) => setValues({ ...values, autoCloseHours: Number(e.target.value) })} required />
      </label>
      <label>Max shift hours{" "}
        <input type="number" min={1} max={48} value={values.maxShiftHours}
          onChange={(e) => setValues({ ...values, maxShiftHours: Number(e.target.value) })} required />
      </label>
      <button type="submit">Save settings</button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Page `src/app/admin/settings/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getSetting } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";

export default async function AdminSettingsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [teamTimezone, gcalCalendarId, autoCloseHours, maxShiftHours] = await Promise.all([
    getSetting<string>("team_timezone", "America/Indiana/Indianapolis"),
    getSetting<string>("gcal_calendar_id", ""),
    getSetting<number>("auto_close_hours", 4),
    getSetting<number>("max_shift_hours", 18),
  ]);

  return (
    <main>
      <h1>Admin — Settings</h1>
      <SettingsForm initial={{ teamTimezone, gcalCalendarId, autoCloseHours, maxShiftHours }} />
      <p><Link href="/admin/kiosk-devices">Manage kiosk devices →</Link></p>
    </main>
  );
}
```

- [ ] **Step 6: Add the nav link**

In `src/components/SiteNav.tsx`, inside the existing `hasRole(viewer.role, "admin")` block, add after the kiosk-devices link:

```tsx
          <Link href="/admin/settings">Admin: Settings</Link>{" "}
```

- [ ] **Step 7: Verify + live gate**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Restart the dev server (Global Constraints recipe), then:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X PATCH http://localhost:3000/api/admin/settings -H 'Content-Type: application/json' -d '{}'"   # 403 anonymous
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/settings"   # 307 (guest redirected to /)
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add /admin/settings page, parser, and route" && git push
```

---

### Task 10: Parked-item polish (code fixes + tests)

Fold in every parked item from the M2/M3 final reviews. Each sub-fix names its exact file and includes a test. Keep it mechanical and well-scoped.

**Files:**
- Modify: `src/app/admin/people/page.tsx`, `src/app/admin/teams/page.tsx`, `src/app/admin/requests/page.tsx`, `src/app/admin/periods/page.tsx`, `src/app/admin/kiosk-devices/page.tsx` (redirect target) — plus any other admin page using `redirect("/login")`.
- Create: `src/lib/people-mutations.test.ts` (createPerson/updatePerson 409/404 branches)
- Modify: `src/app/admin/sessions/flagged/page.tsx` (read `max_shift_hours`)
- Modify: `src/app/page.tsx` (targeted per-person hours query); Modify: `src/lib/reports.ts` (add `personPeriodHours`); Test: extend `src/lib/reports.test.ts`
- Modify: `src/components/KioskDeviceManager.tsx` (in-flight guard)
- Test: extend `src/lib/session-edit.test.ts`, `src/lib/kiosk-request.test.ts`, `src/lib/periods.test.ts` (parser-coverage gaps)
- Create: `supabase/migrations/<timestamp>_one_active_period.sql`; Modify: `src/lib/periods.ts` (simplify `setActivePeriod`)

- [ ] **Step 1 (a): Admin redirect target — `/login` → `/` for a logged-in non-admin**

In each admin page listed above, change the guard from `redirect("/login")` to `redirect("/")`. Example in `src/app/admin/people/page.tsx`:

```tsx
  if (!hasRole(viewer.role, "admin")) redirect("/");
```

Do the same in `admin/teams/page.tsx`, `admin/requests/page.tsx`, `admin/periods/page.tsx`, `admin/kiosk-devices/page.tsx`. (The Task 7/9 pages already use `redirect("/")`.)

Grep to confirm none remain:

```bash
./dev bash -lc "grep -rn 'redirect(\"/login\")' src/app/admin || echo 'none left'"
```

- [ ] **Step 1 (a) verify:** `./dev npm run typecheck`

- [ ] **Step 2 (b): Direct unit tests for `createPerson`/`updatePerson` 409/404 branches**

Create `src/lib/people-mutations.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { createPerson, updatePerson, type PersonInput } from "./people";

const input: PersonInput = {
  firstName: "A", lastName: "B", displayName: "AB", role: "student",
  gradYear: 2028, email: "a@b.com", phone: "1", shirtSize: "M",
  dietaryRestrictions: "none", bio: "hi", studentIdNumber: "42", isActive: true,
};

function insertDb(result: { data?: unknown; error?: { code: string } }) {
  return {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => result }) }),
    }),
  } as never;
}
function updateDb(result: { data?: unknown; error?: { code: string } }) {
  return {
    from: () => ({
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => result }) }) }),
    }),
  } as never;
}

describe("createPerson", () => {
  test("409 on unique violation", async () => {
    const r = await createPerson(input, insertDb({ error: { code: "23505" } }));
    expect(r).toEqual({ ok: false, status: 409 });
  });
  test("ok returns id", async () => {
    const r = await createPerson(input, insertDb({ data: { id: "p1" }, error: undefined }));
    expect(r).toEqual({ ok: true, id: "p1" });
  });
});

describe("updatePerson", () => {
  test("404 when no row matched", async () => {
    const r = await updatePerson("missing", input, updateDb({ data: null, error: undefined }));
    expect(r).toEqual({ ok: false, status: 404 });
  });
  test("409 on unique violation", async () => {
    const r = await updatePerson("p1", input, updateDb({ error: { code: "23505" } }));
    expect(r).toEqual({ ok: false, status: 409 });
  });
});
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3 (c): Flagged page — read `max_shift_hours` instead of the hardcoded "18h"**

In `src/app/admin/sessions/flagged/page.tsx`, add the import `import { getSetting } from "@/lib/settings";`, fetch the setting, and interpolate it into the description. Replace the hardcoded copy:

```tsx
  const period = await getActivePeriod();
  const maxShift = await getSetting<number>("max_shift_hours", 18);
  const flagged = period ? await flaggedSessions(period.id) : [];
```

and the paragraph:

```tsx
      <p>Over {maxShift}h, still open, auto-closed by the nightly sweep, or overlapping another session.</p>
```

- [ ] **Step 4 (d): Dashboard `myHours` over-fetch → a targeted per-person query**

Add to `src/lib/reports.ts`:

```ts
/** Total (rounded) non-excluded hours for ONE person in a period. Avoids a full leaderboard scan. */
export async function personPeriodHours(
  personId: string,
  periodId: string,
  db?: SupabaseClient,
): Promise<number> {
  const sessions = await personSessions(personId, periodId, db);
  return Math.round(totalHours(sessions) * 100) / 100;
}
```

Extend `src/lib/reports.test.ts`:

```ts
import { personPeriodHours } from "./reports";

describe("personPeriodHours", () => {
  test("sums the person's closed sessions", async () => {
    const rows = [
      { id: "s1", person_id: "p1", period_id: "pd1", time_in: "2026-09-01T18:00:00Z",
        time_out: "2026-09-01T20:00:00Z", source: "kiosk", note: null,
        excluded_from_totals: false, edited_by: null, edited_at: null },
    ];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ order: async () => ({ data: rows, error: null }) }) }),
        }),
      }),
    } as never;
    expect(await personPeriodHours("p1", "pd1", db)).toBe(2);
  });
});
```

Then in `src/app/page.tsx`, replace the `periodLeaderboard(...).find(...)` over-fetch. Change the import from `periodLeaderboard` to `personPeriodHours`:

```tsx
import { personPeriodHours } from "@/lib/reports";
```

and the computation:

```tsx
  const myHours =
    viewer.person && activePeriod
      ? await personPeriodHours(viewer.person.id, activePeriod.id)
      : 0;
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 5 (e): `KioskDeviceManager` create in-flight guard**

In `src/components/KioskDeviceManager.tsx`, add a `creating` state and disable the button while the POST is in flight (prevents a double-click creating two devices):

```tsx
  const [creating, setCreating] = useState(false);
  // ...
  async function create() {
    if (creating) return;
    setCreating(true);
    setStatus(null); setNewToken(null);
    try {
      const res = await fetch("/api/admin/kiosk-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const { token } = (await res.json()) as { token: string };
        setNewToken(token);
        setName("");
        router.refresh();
      } else setStatus("Create failed.");
    } finally {
      setCreating(false);
    }
  }
```

and the button:

```tsx
      <button disabled={creating || !name.trim()} onClick={create}>
        {creating ? "Creating…" : "Create"}
      </button>
```

- [ ] **Step 6 (f): Pure-parser test-coverage gaps**

Extend `src/lib/session-edit.test.ts` (invalid-note rejection):

```ts
describe("parseSessionEdit — note edges", () => {
  test("rejects a too-long note (>500)", () => {
    expect(
      parseSessionEdit({ timeIn: "2026-09-01T18:00:00Z", note: "x".repeat(501), excludedFromTotals: false }),
    ).toBeNull();
  });
});
```

Extend `src/lib/kiosk-request.test.ts` (cookie value containing `=`):

```ts
test("keeps '=' inside the cookie value", () => {
  const req = new Request("http://test/", {
    headers: { cookie: "hub_kiosk_token=aGVsbG8=; other=1" },
  });
  expect(kioskTokenFromRequest(req)).toBe("aGVsbG8=");
});
```

Extend `src/lib/periods.test.ts` (too-long period name):

```ts
test("rejects a name longer than 80 chars", () => {
  expect(
    parsePeriodInput({ name: "x".repeat(81), startsOn: "2026-08-01", endsOn: "2026-12-31" }),
  ).toBeNull();
});
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 7 (g): `period(is_active) where is_active` partial unique index + simplify `setActivePeriod`**

```bash
./dev npx supabase migration new one_active_period
```

Fill `supabase/migrations/<timestamp>_one_active_period.sql`:

```sql
-- At most one active period — a DB invariant that kills the non-transactional
-- clear-then-set race in setActivePeriod. Partial unique index: only rows where
-- is_active is true participate, so many inactive periods coexist.
create unique index one_active_period on period ((is_active)) where is_active;
```

Apply + verify (the seed has exactly one active period, so the index builds cleanly):

```bash
./dev npm run db:reset
./dev npm run db:psql -- -c "select indexname from pg_indexes where tablename='period' and indexname='one_active_period';"
# A second active period must now be rejected:
./dev npm run db:psql -- -c "insert into period (name, starts_on, ends_on, is_active) values ('Dup', '2026-08-01', '2027-07-31', true);" 2>&1 | grep -o "one_active_period"
```

Then simplify `setActivePeriod` in `src/lib/periods.ts` — with the index in place, a plain "clear then set" is still needed (Postgres checks the unique index at statement end), but the two writes can run without the pre-existence check racing. Keep the clear-then-set but rely on the index to guarantee correctness; the 404 check stays. Replace the body:

```ts
/** Exactly one active period, enforced by the `one_active_period` partial unique index. */
export async function setActivePeriod(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("period").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  // Clear the current active row first, then set this one. The partial unique
  // index rejects any state with two active periods, so concurrent callers can't
  // both win — the loser gets a 23505 surfaced as 500 and simply retries.
  const { error: clearError } = await client
    .from("period").update({ is_active: false }).eq("is_active", true);
  if (clearError) return { ok: false, status: 500 };
  const { error } = await client.from("period").update({ is_active: true }).eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

(The change is the index + the clarifying comment; behavior is unchanged for the single-writer case and now race-safe.)

- [ ] **Step 8: Full verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
git add -A && git commit -m "fix: fold in M2/M3 parked-item polish (redirects, tests, settings-driven flags, race-safe active period)" && git push
```

---

### Task 11: Full Playwright smoke specs

Using the Task-1 helper. Each spec uses known seeded data (the seeded student `1741`, the seeded mentor with `student_id_number='9999'`). The specs run against a freshly `db:reset` database (in CI, the `e2e` job resets before running), so they do not depend on prior state; the mentor spec's manual session is left in place (a fresh reset clears it). These need the dev server + Supabase up (locally: Global Constraints recipe; in CI: the `e2e` job from Task 1).

**Files:**
- Create: `e2e/kiosk.spec.ts`
- Create: `e2e/authz.spec.ts`
- Create: `e2e/student-login.spec.ts`
- Create: `e2e/mentor.spec.ts`

**Interfaces:**
- Consumes: `mentorSessionCookie`, `SEEDED_STUDENT_ID_NUMBER` (Task 1 helper), the kiosk routes (M3), `/api/admin/*` routes.

- [ ] **Step 1: Kiosk round-trip `e2e/kiosk.spec.ts`**

Registers a kiosk device by inserting a known token hash (no admin session needed), then drives sign-in → who's-here → sign-out via the API (the deterministic surface), asserting DB-visible state through the who's-here endpoint.

```ts
import { expect, test, request as pwRequest } from "@playwright/test";
import { createHash } from "node:crypto";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TOKEN = "e2e-kiosk-token";
const HASH = createHash("sha256").update(TOKEN).digest("hex");

// NOTE: this spec assumes a kiosk_device row with token_hash = HASH exists.
// Insert it once before running (documented in the spec header / CI step):
//   insert into kiosk_device (name, token_hash) values ('E2E Tablet', '<HASH>');
// The CI e2e job seeds it after db reset; locally, run the psql insert shown below.

test("kiosk sign-in → who's-here → sign-out round trip", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });

  // Register the tablet (sets the kiosk cookie in this context's jar).
  const setup = await ctx.post("/api/kiosk/setup", { data: { token: TOKEN } });
  expect(setup.status()).toBe(200);

  // Find the seeded student via who's-here after a clock-in. First get the id
  // by clocking in every candidate is not possible; instead the CI/local step
  // exposes the student id via an env var seeded from psql. Fall back to skip.
  const personId = process.env.E2E_STUDENT_ID;
  test.skip(!personId, "E2E_STUDENT_ID not provided");

  const inRes = await ctx.post("/api/kiosk/clock-in", { data: { personId } });
  expect(inRes.status()).toBe(200);

  const here1 = await (await ctx.get("/api/whos-here")).json();
  expect(here1.here.length).toBeGreaterThanOrEqual(1);

  const outRes = await ctx.post("/api/kiosk/clock-out", { data: { personId } });
  expect(outRes.status()).toBe(200);

  await ctx.dispose();
});
```

> The CI `e2e` job (Task 1) gains two setup lines after the DB reset: insert the kiosk device with `token_hash = <HASH>` and export `E2E_STUDENT_ID` from `select id from person where student_id_number='1741'`. Document the equivalent local psql commands in the spec header.

- [ ] **Step 2: Guest read-only via server RESPONSES `e2e/authz.spec.ts`**

Checks enforcement by response status, not hidden UI.

```ts
import { expect, test, request as pwRequest } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test("guest gets 403 from an admin API (server-enforced, not just hidden UI)", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/admin/build-days", { data: { date: "2026-09-01", kind: "required" } });
  expect(res.status()).toBe(403);
  await ctx.dispose();
});

test("guest is redirected away from /calendar", async ({ page }) => {
  await page.goto("/calendar");
  // redirect("/") lands the guest on the dashboard
  expect(new URL(page.url()).pathname).toBe("/");
});
```

- [ ] **Step 3: Student-ID login `e2e/student-login.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import { SEEDED_STUDENT_ID_NUMBER } from "./helpers/session";

test("a student signs in with their ID number", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/student id/i).fill(SEEDED_STUDENT_ID_NUMBER);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/");
  await expect(page.getByText(/signed in as/i)).toBeVisible();
});
```

> If the login field/button accessible names differ from the M1 login page, adjust the selectors to match `src/app/login/page.tsx` (read it first; do not guess). The assertion target is: after student login, the home page shows the "Signed in as …" line.

- [ ] **Step 4: Authed mentor session edit + `/calendar` loads `e2e/mentor.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import { mentorSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await mentorSessionCookie(BASE)]);
});

test("mentor can load /calendar (mentor+ gate passes)", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: /Calendar/ })).toBeVisible();
});

test("mentor can load the flagged-sessions screen", async ({ page }) => {
  await page.goto("/admin/sessions/flagged");
  await expect(page.getByRole("heading", { name: /Flagged sessions/ })).toBeVisible();
});

test("mentor create-manual-session API accepts a valid payload", async ({ page }) => {
  // Uses the browser context's mentor cookie; needs the seeded student id.
  const personId = process.env.E2E_STUDENT_ID;
  test.skip(!personId, "E2E_STUDENT_ID not provided");
  const res = await page.request.post("/api/admin/sessions", {
    data: {
      personId,
      timeIn: "2026-09-01T18:00:00Z",
      timeOut: "2026-09-01T20:00:00Z",
      note: "e2e manual",
    },
  });
  expect(res.status()).toBe(200);
});
```

- [ ] **Step 5: Run the full suite locally + confirm CI**

Locally (Supabase up, DB reset, dev server up, kiosk device + `E2E_STUDENT_ID` seeded):

```bash
./dev npm run db:psql -- -c "insert into kiosk_device (name, token_hash) values ('E2E Tablet', '$(./dev bash -lc "node -e \"console.log(require('crypto').createHash('sha256').update('e2e-kiosk-token').digest('hex'))\"")');"
# Route psql through `./dev bash -lc` and take the last line so the npm-script header
# noise doesn't end up in the variable.
STUDENT=$(./dev bash -lc "psql postgresql://postgres:postgres@host.docker.internal:54322/postgres -tA -c \"select id from person where student_id_number='1741';\"" | tail -1 | tr -d '[:space:]')
./dev bash -lc "STUDENT_SESSION_SECRET=$STUDENT_SESSION_SECRET E2E_STUDENT_ID=$STUDENT npm run e2e"
```

Expected: all specs pass (a couple may `skip` if `E2E_STUDENT_ID` is unset — the CI job provides it).

- [ ] **Step 6: Wire the CI seed lines + commit**

Add to the Task-1 CI `e2e` job, right after the DB-reset step (before build), the kiosk-device insert and `E2E_STUDENT_ID` export (via `psql` against `127.0.0.1:54322`). Then:

```bash
./dev npm run lint && ./dev npm run typecheck
git add -A && git commit -m "test: add full Playwright smoke specs (kiosk, authz, student login, mentor)" && git push
```

Confirm on the HOST: `gh run watch --exit-status`.

---

### Task 12: Deploy runbook + env reference (DOCS ONLY — no actual deploy)

**The actual production deploy is performed BY THE USER following this runbook. This milestone does NOT run any deploy, and the Vercel MCP deploy tools MUST NOT be used.** This task writes the doc and makes one small production-aware `clientIp` change (with a test), then updates the README.

**Files:**
- Create: `docs/setup/deploy.md`
- Modify: `src/lib/rate-limit.ts` (production-aware `clientIp`); Test: extend `src/lib/rate-limit.test.ts`
- Modify: `README.md` ("what's built" → v1 feature-complete)

**Interfaces:**
- Consumes: existing `clientIp` callers (M2/M3 public routes) — signature-compatible change.
- Produces: `clientIp(request: Request): string` now prefers a platform-trusted real-IP header in production.

- [ ] **Step 1: Write the failing `clientIp` test**

Extend (or create) `src/lib/rate-limit.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { clientIp } from "./rate-limit";

describe("clientIp", () => {
  test("prefers the trusted real-IP header when present", () => {
    const req = new Request("http://test/", {
      headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(clientIp(req)).toBe("9.9.9.9");
  });
  test("falls back to the first x-forwarded-for hop", () => {
    const req = new Request("http://test/", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(clientIp(req)).toBe("1.1.1.1");
  });
  test("unknown when no headers", () => {
    expect(clientIp(new Request("http://test/"))).toBe("unknown");
  });
});
```

Run: `./dev npm run test` → FAIL (the real-IP preference isn't implemented yet).

- [ ] **Step 2: Update `clientIp` in `src/lib/rate-limit.ts`**

```ts
export function clientIp(request: Request): string {
  // On Vercel (and most platforms) x-real-ip is set by the trusted proxy to the
  // true client IP and cannot be spoofed by the client, unlike x-forwarded-for
  // (whose first hop a client can forge). Prefer it; fall back for local/dev.
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Write `docs/setup/deploy.md`**

State at the very top, in bold: **"The production deploy is performed by you (the team) following this runbook. Claude does NOT run any deploy step, and the Vercel MCP tools are not used. Every command here you run yourself."** Then cover, step-by-step:

1. **Supabase hosted project:** create the project; run `supabase link` + `supabase db push` to apply all migrations; note that RLS-zero-policy tables are service-role-only (no client data path).
2. **Enable `pg_cron` + `pg_net`** on the hosted project (Dashboard → Database → Extensions). Re-run the cron migration if the extensions were unavailable during local `db:reset` (the commented lines from Task 6). Set `app_setting.sync_url` to the **production** sync URL (`https://<app-domain>/api/admin/calendar/sync`) and `app_setting.gcal_sync_secret` to a strong non-empty value.
3. **Vercel project:** import the repo; framework preset Next.js; no special build overrides.
4. **Full env-var reference** (a table — name, where set, example, secret?):
   - `NEXT_PUBLIC_SUPABASE_URL` (public), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public) — the hosted project's URL + anon key.
   - `SUPABASE_SERVICE_ROLE_KEY` (secret) — hosted service-role key.
   - `SUPABASE_INTERNAL_URL` — **leave UNSET in production** (only the dev container needs it; `serverSupabaseUrl()` then uses the public URL).
   - `STUDENT_SESSION_SECRET` (secret) — strong random; signs student app-JWTs.
   - `AUTH_COOKIE_NAME` — `sb-teamhub-auth-token` (must match everywhere).
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — production OAuth client (per `google-oauth.md` §Production).
   - `GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` (secret) — the calendar service account (per `google-calendar.md`); note the `\n` escaping for the key.
   - `gcal_calendar_id` / `gcal_sync_secret` / `sync_url` — these live in `app_setting`, not env (set via Admin → Settings or SQL).
5. **Production Google OAuth:** register the hosted Supabase callback (`https://<project-ref>.supabase.co/auth/v1/callback`) in the OAuth client; set the hosted project's Site URL + redirect allow-list to `https://<app-domain>/auth/callback` (cross-link `google-oauth.md`).
6. **Rate-limit real-IP:** note that `clientIp` (Step 2) now prefers `x-real-ip`, which Vercel sets to the true client IP — no extra config needed; call out that if deploying behind a different proxy, verify which header is the trusted one.
7. **Post-deploy smoke:** sign in as the bootstrap admin (first Google sign-in → admin), create a period, register a kiosk device, connect the calendar, trigger a manual sync, confirm `/calendar` renders.

- [ ] **Step 4: Update `README.md` "what's built"**

Update the "What's built so far" list to reflect **v1 feature-complete**: roster + teams; split-audience auth (student ID + mentor Google OAuth) with first-user-admin bootstrap; kiosk sign-in/out + who's-here; periods; hours + leaderboard + per-member detail; flagged-session review + nightly auto-close sweep; Google Calendar sync + build days (required/optional) + excusals; the `/calendar` attendance grid; `/me/attendance`; `/admin/settings`; a Playwright smoke suite; and the deploy runbook (`docs/setup/deploy.md`). Note that GCal end-to-end and the production deploy are user-driven (credential/account-gated).

- [ ] **Step 5: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
git add -A && git commit -m "docs: add deploy runbook + env reference; make clientIp production-aware" && git push
```

Confirm on the HOST: `gh run watch --exit-status`.

---

## Self-review notes

**Spec coverage (M4 slice) — each item mapped to a task:**
- **GCal sync (spec §5)** → Task 5 (injectable-fetch `syncCalendar`, dual-gated route, setup doc) + Task 6 (hourly pg_cron/pg_net). Meeting + build_day tables/types → Task 2.
- **Build days required/optional + manual creation (§4, §6)** → Task 2 (schema, `kind`/`source` stored not derived) + Task 4 (libraries, upsert precedence, CRUD routes) + Task 9 UI links; grid edit in Task 7.
- **Excusals + denominator math (§4)** → Task 2 (table) + Task 4 (library/route) + Task 3 (denominator shrink, present-beats-excused).
- **Attendance computation, timezone-aware (§4, Timezone policy)** → Task 3 (`localDateOf` via `Intl`, `attendanceForDate`, `attendanceSummary`). Reused by Tasks 5 (meeting→build_day date), 7, 8.
- **`/calendar` grid (§6)** → Task 7. **`/me/attendance` (§6)** → Task 8. **Dashboard upcoming meetings (§6)** → Task 8.
- **`/admin/settings` (§6)** → Task 9 (timezone, gcal calendar id, auto-close/max-shift hours, kiosk-devices link).
- **Playwright smoke: kiosk round trip, guest read-only via server responses, student-ID login, mentor session edit (§7)** → Task 11; harness/CI/authed helper → Task 1.
- **Production deploy (§2, roadmap M4 scope decision)** → Task 12 (runbook + env reference + real-IP fix), user-driven; Vercel MCP tools NOT used.
- **Parked items (M2/M3 carry-forwards)** → Task 10 (all seven sub-fixes: admin redirect target, createPerson/updatePerson tests, settings-driven flagged threshold, dashboard hours over-fetch, kiosk create in-flight guard, three parser-coverage gaps, one-active-period partial unique index).

**Three decisions where the spec/advice left latitude (stated in-plan, surfaced here):**
1. **Attendance denominator:** required days only; `denominator = present + absent` (excused required days excluded → the "shrink"; optional days never count), `numerator = present`, `percentage = null` when denominator 0, rounded `Math.round(x*100)/100`. **Present beats excused** so a session on an excused day counts in both numerator and denominator — covered by an explicit test.
2. **GCal transport:** inject `fetch` itself (`type GcalTransport = typeof globalThis.fetch`) as the single seam; the test's fake dispatches on URL (token endpoint vs events endpoint). RS256 is done with Node `crypto.createSign("RSA-SHA256")` per the prompt (no new dependency; `jose` would also work but the prompt specified `crypto`).
3. **pg_net URL/secret mechanism:** both `sync_url` and `gcal_sync_secret` live in `app_setting` and are read by the cron command via sub-selects at run time (so the production URL/secret need no new migration). The sync route's secret gate requires the stored secret to be **non-empty** before comparing — an empty seeded secret authorizes no one (guarding the `"" === ""` trap).

**Deliberate divergence recorded:** Task 8 shows upcoming meetings to **signed-in viewers** (per the milestone task decomposition, which binds), whereas spec §8 answer 2 lists "meeting schedule" in guest scope. Chose the prompt; widening to guests later is a one-line change to the dashboard's guest branch.

**Type/interface consistency:** `BuildDay`/`BuildDayKind`/`Excusal`/`Meeting` + their `fromRow` mappers (Task 2) are consumed unchanged by attendance (Task 3), build-days/excusals (Task 4), gcal (Task 5), grid (Task 7), and `/me/attendance` (Task 8). `localDateOf(iso, tz)` is defined once (Task 3) and reused by `syncCalendar` (Task 5). `sessionsForPeriod` (Task 7) and `personPeriodHours` (Task 10) are additive to `reports.ts`. The sync route's gate names (`gcal_sync_secret`, `gcal_calendar_id`, `sync_url`) match the seed (Task 2), the cron sub-selects (Task 6), and the settings writer (Task 9, which owns `gcal_calendar_id`). `mentorSessionCookie`/`SEEDED_MENTOR_ID`/`SEEDED_STUDENT_ID_NUMBER` (Task 1) are consumed by Task 11 specs.

**Verification posture — local vs credential-gated:** locally verified end-to-end — the manual build-day + excusal path (Task 4), attendance computation (Task 3, exhaustive units incl. DST + midnight-span), the sync library against a fake payload (Task 5 units), the dual-gate route behavior with an empty/set secret (Task 5 curl), the cron migration + settings (Task 6, `pg_net` tolerated-if-unavailable like M3-Task-8), the grid/`/me/attendance`/settings pages (Task 7–9 live gates), all parked-item fixes (Task 10 tests), and the Playwright suite (Task 1 + 11, in-container and CI). **Credential-gated on the user (not run here):** the real Google Calendar round-trip (service account + shared calendar), production Google OAuth, and the Vercel + hosted-Supabase deploy — all shipped as `docs/setup/google-calendar.md` + `docs/setup/deploy.md`, mirroring the OAuth precedent.

**Deliberately deferred (out of v1):** everything in issues #1–#27 (Realtime who's-here, meeting-end auto-close backdating, Wi-Fi/offsite presence, badges, etc.). No session versioning/audit tables beyond `edited_by`/`edited_at`. No email anywhere.
</invoke>
