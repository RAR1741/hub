# Milestone 3: Attendance Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members clock in/out at a kiosk, mentors see who's here and each member's hours, forgotten sessions heal automatically overnight, and mentors can review and correct flagged sessions — turning the roster app into a working attendance tracker.

**Architecture:** Same seams as M1/M2. Pure logic (hours math, flag detection, clock decisions, token hashing) lives in `src/lib/` with Vitest tests. Reads happen in server components calling typed query functions (service-role `getDb()`, scoping in app code). Mutations happen in `withRole`-guarded API routes, except the kiosk clock endpoints, which are gated by a **kiosk device token** (a registered-tablet cookie) rather than a user session — the spec's kiosk trust model. The nightly forgotten-sign-out heal is a **pg_cron** job running a timezone-aware SQL function; a manual "run sweep now" admin route makes it testable without waiting for cron.

**Tech Stack:** As-built: Next.js 16.3 (App Router, TS strict), Supabase (CLI 2.113 devDependency; Postgres 15 with `pg_cron`), `@supabase/ssr`, Vitest 4, Node `crypto` (built-in). No new npm dependencies.

## Global Constraints (binding for every task)

- **Nothing installed on the host.** Every npm/npx/node/psql command runs inside the dev container: from the host prefix with `./dev` (e.g. `./dev npm run test`). **Git runs on the HOST** (it owns credentials). If Git Bash mangles a path argument, prefix `MSYS_NO_PATHCONV=1`.
- **Every commit is pushed immediately** (`git push` right after `git commit`).
- TypeScript strict; Node 22.
- All timestamps `timestamptz` (UTC); UUID PKs via `gen_random_uuid()`. **Store UTC everywhere; all day-boundary logic converts through the team timezone** in `app_setting` key `team_timezone` (default `"America/Indiana/Indianapolis"`).
- Roles exactly `admin`, `mentor`, `captain`, `student` (+ `guest` app-level only). Rank order (`src/lib/authz.ts`): guest < student < captain < mentor < admin.
- **RLS enabled on every new table with ZERO policies** — service-role-only access.
- Server-side Supabase always via `serverSupabaseUrl()`; the browser client (`src/lib/supabase-browser.ts`) is the only public-URL exception. All Supabase **auth** clients share `AUTH_COOKIE_NAME` (`src/lib/supabase-cookie.ts`).
- Secrets only in `.env.local` / `.env` (both gitignored); never committed.
- Guest data scope unchanged (M2): guests see names, not detail. Attendance detail (hours, sessions) is mentor+ or self.
- db scripts: `npm run db:start | db:stop | db:reset | db:psql` (container-specific flags — do not "clean up").
- Plain semantic HTML; no CSS frameworks.

**Existing interfaces this milestone consumes (as-built):**
- `src/lib/api.ts`: `withRole<C>(required, handler, viewerSource?)`; `[id]` routes use `type Ctx = { params: Promise<{ id: string }> }`, `await context.params`.
- `src/lib/viewer.ts`: `type Viewer = { person: Person | null; role: Role }`, `getViewer()`.
- `src/lib/authz.ts`: `hasRole(actual, required)`, `ForbiddenError`, `requireRole`.
- `src/lib/db.ts`: `getDb()` (server-only service-role client). Supports `.rpc(name, args?)`.
- `src/lib/validate.ts`: `reqString(v,max)`, `optString(v,max)` (`{value}|null`), `optInt(v,min,max)` (`{value}|null`).
- `src/lib/settings.ts`: `getSetting<T>(key, fallback, db?)`.
- `src/lib/people.ts`: `displayName(p)`, `listPeople(q?, db?)`, `getPersonWithTeams(id, db?)`.
- `src/lib/types.ts`: `Role`, `PersonRow`, `Person`, `personFromRow`.
- DB (from M1): `person`, `kiosk_device (id, name, token_hash unique, created_by, last_seen_at, created_at)`, `app_setting (key pk, value jsonb)`.

---

### Task 1: Schema (period, session), settings, and domain types

**Files:**
- Create: `supabase/migrations/<timestamp>_attendance.sql` (via `npx supabase migration new attendance`)
- Modify: `supabase/seed.sql`
- Modify: `src/lib/types.ts`
- Test: extend `src/lib/types.test.ts`

**Interfaces:**
- Consumes: existing `person`, `app_setting`.
- Produces:
  - Tables `period`, `session`; partial unique index `one_open_session_per_person`; seeded `period` (active) and `app_setting` rows `auto_close_hours` (4), `max_shift_hours` (18).
  - `type SessionSource = "kiosk" | "manual" | "admin"`
  - `type PeriodRow = { id: string; name: string; starts_on: string; ends_on: string; is_active: boolean }`, `type Period = { id: string; name: string; startsOn: string; endsOn: string; isActive: boolean }`, `periodFromRow(row: PeriodRow): Period`
  - `type SessionRow = { id: string; person_id: string; period_id: string; time_in: string; time_out: string | null; source: SessionSource; note: string | null; excluded_from_totals: boolean; edited_by: string | null; edited_at: string | null }`, `type Session = { id: string; personId: string; periodId: string; timeIn: string; timeOut: string | null; source: SessionSource; note: string | null; excludedFromTotals: boolean; editedBy: string | null; editedAt: string | null }`, `sessionFromRow(row: SessionRow): Session`

- [ ] **Step 1: Create the migration**

```bash
./dev npx supabase migration new attendance
```

Fill `supabase/migrations/<timestamp>_attendance.sql`:

```sql
-- Periods / seasons scope sessions and separate history (spec §4). One active at a time.
create table period (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table session (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  period_id uuid not null references period (id) on delete restrict,
  time_in timestamptz not null default now(),
  time_out timestamptz,
  source text not null default 'kiosk' check (source in ('kiosk', 'manual', 'admin')),
  note text,
  excluded_from_totals boolean not null default false,
  -- edited_by set = a human corrected this; edited_at set with edited_by NULL = the
  -- nightly sweep auto-closed it (system edit). The flagged screen keys off that.
  edited_by uuid references person (id),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open session per person (Den's invariant): a second clock-in while still
-- clocked in violates this and is rejected (23505) by the clock-in code.
create unique index one_open_session_per_person
  on session (person_id)
  where time_out is null;

-- Fast lookups for who's-here and per-person history.
create index session_open_idx on session (time_out) where time_out is null;
create index session_person_idx on session (person_id, time_in);

alter table period enable row level security;
alter table session enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).

insert into app_setting (key, value) values
  ('auto_close_hours', '4'),   -- sweep closes a forgotten session at time_in + this
  ('max_shift_hours', '18');   -- sessions longer than this are "suspect" on the flagged screen
```

- [ ] **Step 2: Seed an active period**

Append to `supabase/seed.sql`:

```sql
insert into period (name, starts_on, ends_on, is_active)
values ('2026–2027 Season', '2026-08-01', '2027-07-31', true);
```

- [ ] **Step 3: Apply and verify**

```bash
./dev npm run db:reset
./dev npm run db:psql -- -c "select name, is_active from period;"
./dev npm run db:psql -- -c "select key, value from app_setting order by key;"
./dev npm run db:psql -- -c "select indexname from pg_indexes where tablename='session';"
./dev npm run db:psql -- -c "select relname, relrowsecurity from pg_class where relname in ('period','session');"
./dev npm run db:psql -- -c "select count(*) from pg_policies where tablename in ('period','session');"
```

Expected: one active period; `auto_close_hours`/`max_shift_hours`/`team_timezone` present; the `one_open_session_per_person` index listed; both tables `relrowsecurity = t`; policy count 0.

- [ ] **Step 4: Write the failing type tests**

Append to `src/lib/types.test.ts`:

```ts
import { periodFromRow, sessionFromRow, type PeriodRow, type SessionRow } from "./types";

describe("periodFromRow", () => {
  test("maps snake_case to camelCase", () => {
    const row: PeriodRow = {
      id: "pd1", name: "S", starts_on: "2026-08-01", ends_on: "2027-07-31", is_active: true,
    };
    expect(periodFromRow(row)).toEqual({
      id: "pd1", name: "S", startsOn: "2026-08-01", endsOn: "2027-07-31", isActive: true,
    });
  });
});

describe("sessionFromRow", () => {
  test("maps all fields", () => {
    const row: SessionRow = {
      id: "s1", person_id: "p1", period_id: "pd1",
      time_in: "2026-09-01T22:00:00Z", time_out: null,
      source: "kiosk", note: null, excluded_from_totals: false,
      edited_by: null, edited_at: null,
    };
    expect(sessionFromRow(row)).toEqual({
      id: "s1", personId: "p1", periodId: "pd1",
      timeIn: "2026-09-01T22:00:00Z", timeOut: null,
      source: "kiosk", note: null, excludedFromTotals: false,
      editedBy: null, editedAt: null,
    });
  });
});
```

Run: `./dev npm run test` → FAIL (exports missing).

- [ ] **Step 5: Extend `src/lib/types.ts`**

Append:

```ts
export type SessionSource = "kiosk" | "manual" | "admin";

export type PeriodRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
};

export type Period = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
};

export function periodFromRow(row: PeriodRow): Period {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    isActive: row.is_active,
  };
}

export type SessionRow = {
  id: string;
  person_id: string;
  period_id: string;
  time_in: string;
  time_out: string | null;
  source: SessionSource;
  note: string | null;
  excluded_from_totals: boolean;
  edited_by: string | null;
  edited_at: string | null;
};

export type Session = {
  id: string;
  personId: string;
  periodId: string;
  timeIn: string;
  timeOut: string | null;
  source: SessionSource;
  note: string | null;
  excludedFromTotals: boolean;
  editedBy: string | null;
  editedAt: string | null;
};

export function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id,
    personId: row.person_id,
    periodId: row.period_id,
    timeIn: row.time_in,
    timeOut: row.time_out,
    source: row.source,
    note: row.note,
    excludedFromTotals: row.excluded_from_totals,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
  };
}
```

- [ ] **Step 6: Verify + commit**

```bash
./dev npm run test && ./dev npm run lint && ./dev npm run typecheck
git add -A && git commit -m "feat: add period/session schema, settings, and attendance types" && git push
```

---

### Task 2: Hours math and flag detection (pure logic)

**Files:**
- Create: `src/lib/hours.ts`; Test: `src/lib/hours.test.ts`

**Interfaces:**
- Consumes: `Session` from `types.ts`.
- Produces:
  - `sessionHours(s: Pick<Session, "timeIn" | "timeOut">, now?: () => number): number` — closed session duration in hours (open sessions measured to `now`); never negative.
  - `totalHours(sessions: Session[]): number` — sum over non-excluded sessions (open ones excluded from totals).
  - `type FlagKind = "over_max" | "still_open" | "auto_closed"`
  - `sessionFlags(s: Session, maxShiftHours: number, now?: () => number): FlagKind[]` — which flags apply to one session (excludes overlap, which is cross-session — see `overlappingSessionIds`).
  - `overlappingSessionIds(sessions: Session[]): Set<string>` — ids of sessions that overlap another session for the SAME person.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/hours.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  overlappingSessionIds,
  sessionFlags,
  sessionHours,
  totalHours,
} from "./hours";
import type { Session } from "./types";

const base: Session = {
  id: "s", personId: "p1", periodId: "pd1",
  timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z",
  source: "kiosk", note: null, excludedFromTotals: false, editedBy: null, editedAt: null,
};

describe("sessionHours", () => {
  test("closed session duration", () => {
    expect(sessionHours(base)).toBe(3);
  });
  test("open session measured to now", () => {
    const now = () => Date.parse("2026-09-01T19:30:00Z");
    expect(sessionHours({ timeIn: base.timeIn, timeOut: null }, now)).toBe(1.5);
  });
  test("never negative", () => {
    expect(
      sessionHours({ timeIn: "2026-09-01T21:00:00Z", timeOut: "2026-09-01T18:00:00Z" }),
    ).toBe(0);
  });
});

describe("totalHours", () => {
  test("sums closed non-excluded sessions; skips open and excluded", () => {
    const sessions: Session[] = [
      base,
      { ...base, id: "s2", timeOut: "2026-09-01T20:00:00Z" }, // 2h
      { ...base, id: "s3", excludedFromTotals: true },        // skipped
      { ...base, id: "s4", timeOut: null },                   // open → skipped
    ];
    expect(totalHours(sessions)).toBe(5);
  });
});

describe("sessionFlags", () => {
  test("still_open for an open session", () => {
    expect(sessionFlags({ ...base, timeOut: null }, 18)).toContain("still_open");
  });
  test("over_max for a session longer than maxShiftHours", () => {
    const long = { ...base, timeOut: "2026-09-02T14:00:00Z" }; // 20h
    expect(sessionFlags(long, 18)).toContain("over_max");
  });
  test("auto_closed when edited_at set but edited_by null and closed", () => {
    const swept = { ...base, editedAt: "2026-09-02T08:00:00Z", editedBy: null };
    expect(sessionFlags(swept, 18)).toContain("auto_closed");
  });
  test("a clean short session has no flags", () => {
    expect(sessionFlags(base, 18)).toEqual([]);
  });
});

describe("overlappingSessionIds", () => {
  test("flags two sessions that overlap for the same person", () => {
    const a = { ...base, id: "a", timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T20:00:00Z" };
    const b = { ...base, id: "b", timeIn: "2026-09-01T19:00:00Z", timeOut: "2026-09-01T21:00:00Z" };
    const c = { ...base, id: "c", personId: "p2", timeIn: "2026-09-01T19:00:00Z", timeOut: "2026-09-01T21:00:00Z" };
    const ids = overlappingSessionIds([a, b, c]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(false); // different person
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/hours.ts`**

```ts
import type { Session } from "./types";

const MS_PER_HOUR = 3_600_000;

export function sessionHours(
  s: Pick<Session, "timeIn" | "timeOut">,
  now: () => number = Date.now,
): number {
  const start = Date.parse(s.timeIn);
  const end = s.timeOut ? Date.parse(s.timeOut) : now();
  return Math.max(0, (end - start) / MS_PER_HOUR);
}

/** Sum of closed, non-excluded sessions. Open sessions don't count toward totals. */
export function totalHours(sessions: Session[]): number {
  return sessions
    .filter((s) => s.timeOut && !s.excludedFromTotals)
    .reduce((sum, s) => sum + sessionHours(s), 0);
}

export type FlagKind = "over_max" | "still_open" | "auto_closed";

export function sessionFlags(
  s: Session,
  maxShiftHours: number,
  now: () => number = Date.now,
): FlagKind[] {
  const flags: FlagKind[] = [];
  if (!s.timeOut) flags.push("still_open");
  if (sessionHours(s, now) > maxShiftHours) flags.push("over_max");
  if (s.timeOut && s.editedAt && !s.editedBy) flags.push("auto_closed");
  return flags;
}

/** Ids of sessions overlapping another session for the SAME person. */
export function overlappingSessionIds(sessions: Session[]): Set<string> {
  const ids = new Set<string>();
  const byPerson = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = byPerson.get(s.personId) ?? [];
    list.push(s);
    byPerson.set(s.personId, list);
  }
  for (const list of byPerson.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const aStart = Date.parse(a.timeIn);
        const aEnd = a.timeOut ? Date.parse(a.timeOut) : Infinity;
        const bStart = Date.parse(b.timeIn);
        const bEnd = b.timeOut ? Date.parse(b.timeOut) : Infinity;
        if (aStart < bEnd && bStart < aEnd) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
  }
  return ids;
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hours.ts src/lib/hours.test.ts
git commit -m "feat: add hours math and flag-detection pure logic" && git push
```

---

### Task 3: Periods admin (library, routes, page)

**Files:**
- Create: `src/lib/periods.ts`; Test: `src/lib/periods.test.ts`
- Create: `src/app/api/admin/periods/route.ts`
- Create: `src/app/api/admin/periods/[id]/route.ts`
- Create: `src/components/PeriodForm.tsx`
- Create: `src/app/admin/periods/page.tsx`

**Interfaces:**
- Consumes: `withRole<C>`, `validate` (`reqString`, `optString`), `Period`/`PeriodRow`/`periodFromRow`, `getViewer`, `hasRole`.
- Produces:
  - `parsePeriodInput(body): { name: string; startsOn: string; endsOn: string } | null` — PURE; validates name and two `YYYY-MM-DD` dates (endsOn ≥ startsOn).
  - `listPeriods(db?): Promise<Period[]>` (newest first by starts_on)
  - `getActivePeriod(db?): Promise<Period | null>`
  - `createPeriod(input, db?)` (409 dup name)
  - `updatePeriod(id, input, db?)` (404 miss; 409 dup)
  - `setActivePeriod(id, db?)` — deactivates all others, activates this one (404 if missing)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/periods.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parsePeriodInput } from "./periods";

describe("parsePeriodInput", () => {
  test("accepts a valid period", () => {
    expect(
      parsePeriodInput({ name: " Fall ", startsOn: "2026-08-01", endsOn: "2026-12-31" }),
    ).toEqual({ name: "Fall", startsOn: "2026-08-01", endsOn: "2026-12-31" });
  });
  test.each([
    [{ name: "", startsOn: "2026-08-01", endsOn: "2026-12-31" }],
    [{ name: "X", startsOn: "not-a-date", endsOn: "2026-12-31" }],
    [{ name: "X", startsOn: "2026-08-01", endsOn: "2026-07-01" }], // end before start
    [{ name: "X", startsOn: "2026-08-01" }],                        // missing end
    [null],
  ])("rejects %j", (body) => {
    expect(parsePeriodInput(body)).toBeNull();
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/periods.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Period, PeriodRow } from "./types";
import { periodFromRow } from "./types";
import { reqString } from "./validate";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodInput = { name: string; startsOn: string; endsOn: string };

/** Validate a period payload. PURE. Null = invalid. */
export function parsePeriodInput(body: unknown): PeriodInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 80);
  const startsOn = typeof b.startsOn === "string" && ISO_DATE.test(b.startsOn) ? b.startsOn : null;
  const endsOn = typeof b.endsOn === "string" && ISO_DATE.test(b.endsOn) ? b.endsOn : null;
  if (!name || !startsOn || !endsOn) return null;
  if (Date.parse(endsOn) < Date.parse(startsOn)) return null;
  return { name, startsOn, endsOn };
}

const UNIQUE_VIOLATION = "23505";

export async function listPeriods(db?: SupabaseClient): Promise<Period[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("period").select("*").order("starts_on", { ascending: false });
  return ((data ?? []) as PeriodRow[]).map(periodFromRow);
}

export async function getActivePeriod(db?: SupabaseClient): Promise<Period | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("period").select("*").eq("is_active", true).maybeSingle();
  return data ? periodFromRow(data as PeriodRow) : null;
}

export async function createPeriod(
  input: PeriodInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("period")
    .insert({ name: input.name, starts_on: input.startsOn, ends_on: input.endsOn })
    .select("id")
    .single();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  return { ok: true, id: data.id as string };
}

export async function updatePeriod(
  id: string,
  input: PeriodInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("period")
    .update({ name: input.name, starts_on: input.startsOn, ends_on: input.endsOn })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Exactly one active period: clear all, then set this one. */
export async function setActivePeriod(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("period").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { error: clearError } = await client
    .from("period")
    .update({ is_active: false })
    .eq("is_active", true);
  if (clearError) return { ok: false, status: 500 };
  const { error } = await client.from("period").update({ is_active: true }).eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Routes**

Create `src/app/api/admin/periods/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createPeriod, parsePeriodInput } from "@/lib/periods";

export const POST = withRole("admin", async (_viewer, request) => {
  const input = parsePeriodInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createPeriod(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
```

Create `src/app/api/admin/periods/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { parsePeriodInput, setActivePeriod, updatePeriod } from "@/lib/periods";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  // { action: "activate" } activates; otherwise it's a field update.
  if (body?.action === "activate") {
    const result = await setActivePeriod(id);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  const input = parsePeriodInput(body);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updatePeriod(id, input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 4: Form component `src/components/PeriodForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PeriodFormValues = { name: string; startsOn: string; endsOn: string };

export function PeriodForm({
  initial,
  periodId,
}: {
  initial?: PeriodFormValues;
  periodId?: string;
}) {
  const [values, setValues] = useState<PeriodFormValues>(
    initial ?? { name: "", startsOn: "", endsOn: "" },
  );
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch(periodId ? `/api/admin/periods/${periodId}` : "/api/admin/periods", {
      method: periodId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) {
      setStatus("Saved.");
      router.refresh();
      if (!periodId) setValues({ name: "", startsOn: "", endsOn: "" });
    } else if (res.status === 409) {
      setStatus("A period with that name already exists.");
    } else {
      setStatus("Save failed — check the fields (end date must be on/after start).");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>Name <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required /></label>
      <label>Starts <input type="date" value={values.startsOn} onChange={(e) => setValues({ ...values, startsOn: e.target.value })} required /></label>
      <label>Ends <input type="date" value={values.endsOn} onChange={(e) => setValues({ ...values, endsOn: e.target.value })} required /></label>
      <button type="submit">{periodId ? "Save changes" : "Create period"}</button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Page `src/app/admin/periods/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeriods } from "@/lib/periods";
import { PeriodForm } from "@/components/PeriodForm";
import { ActivatePeriodButton } from "@/components/ActivatePeriodButton";

export default async function AdminPeriodsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const periods = await listPeriods();
  return (
    <main>
      <h1>Admin — Periods</h1>
      <h2>Create period</h2>
      <PeriodForm />
      <h2>All periods</h2>
      <table>
        <thead><tr><th>Name</th><th>Starts</th><th>Ends</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.startsOn}</td><td>{p.endsOn}</td>
              <td>{p.isActive ? "active" : ""}</td>
              <td>{p.isActive ? null : <ActivatePeriodButton periodId={p.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

Create `src/components/ActivatePeriodButton.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";

export function ActivatePeriodButton({ periodId }: { periodId: string }) {
  const router = useRouter();
  async function activate() {
    const res = await fetch(`/api/admin/periods/${periodId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activate" }),
    });
    if (res.ok) router.refresh();
  }
  return <button onClick={activate}>Make active</button>;
}
```

(Add `src/components/ActivatePeriodButton.tsx` to this task's file list — it is part of Step 5.)

- [ ] **Step 6: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live authz (dev server up):

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/periods -H 'Content-Type: application/json' -d '{}'"   # 403
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/periods"   # 307
```

```bash
git add -A && git commit -m "feat: add periods admin (library, routes, page)" && git push
```

---

### Task 4: Kiosk device tokens + session clock library

**Files:**
- Create: `src/lib/kiosk.ts`; Test: `src/lib/kiosk.test.ts`
- Create: `src/lib/sessions.ts`; Test: `src/lib/sessions.test.ts`
- Create: `src/app/api/admin/kiosk-devices/route.ts`
- Create: `src/app/api/admin/kiosk-devices/[id]/route.ts`

**Interfaces:**
- Consumes: `getDb`, `reqString`, `getActivePeriod` (Task 3), `displayName` (people), `Session`/`sessionFromRow`.
- Produces:
  - `KIOSK_COOKIE = "hub_kiosk_token"`
  - `hashKioskToken(token: string): string` — sha256 hex. PURE.
  - `generateKioskToken(): string` — 32-byte base64url random. (Uses `crypto`; test only asserts shape/length + uniqueness.)
  - `createKioskDevice(name: string, createdBy: string, db?): Promise<{ token: string; id: string }>` — stores the HASH, returns the plaintext token ONCE.
  - `listKioskDevices(db?)`, `deleteKioskDevice(id, db?)`
  - `verifyKioskToken(token: string | undefined, db?): Promise<boolean>` — hashes, looks up `kiosk_device`, bumps `last_seen_at`; false if absent/unknown.
  - `type ClockResult = { ok: true } | { ok: false; status: number; reason: string }`
  - `clockIn(personId: string, db?): Promise<ClockResult>` — requires an active period (409 `no_active_period`); one-open enforced (409 `already_in` on 23505).
  - `clockOut(personId: string, db?): Promise<ClockResult>` — closes the person's open session (404 `not_in` if none).
  - `type WhosHereEntry = { personId: string; name: string; since: string }`
  - `listWhosHere(db?): Promise<WhosHereEntry[]>` — open sessions joined to person, ordered by `time_in`.
  - `activeMembersForKiosk(db?): Promise<{ id: string; name: string }[]>` — active people NOT currently clocked in, alphabetized (the kiosk sign-in grid).

- [ ] **Step 1: Write the failing kiosk tests**

Create `src/lib/kiosk.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { generateKioskToken, hashKioskToken } from "./kiosk";

describe("hashKioskToken", () => {
  test("is deterministic sha256 hex (64 chars)", () => {
    const h = hashKioskToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKioskToken("abc")).toBe(h);
    expect(hashKioskToken("abd")).not.toBe(h);
  });
});

describe("generateKioskToken", () => {
  test("produces distinct, url-safe tokens", () => {
    const a = generateKioskToken();
    const b = generateKioskToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/kiosk.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const KIOSK_COOKIE = "hub_kiosk_token";

export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateKioskToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createKioskDevice(
  name: string,
  createdBy: string,
  db?: SupabaseClient,
): Promise<{ token: string; id: string } | null> {
  const client = db ?? (await import("./db")).getDb();
  const token = generateKioskToken();
  const { data, error } = await client
    .from("kiosk_device")
    .insert({ name, token_hash: hashKioskToken(token), created_by: createdBy })
    .select("id")
    .single();
  if (error) return null;
  return { token, id: data.id as string };
}

export async function listKioskDevices(
  db?: SupabaseClient,
): Promise<{ id: string; name: string; lastSeenAt: string | null }[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("kiosk_device")
    .select("id, name, last_seen_at")
    .order("name");
  return (data ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    lastSeenAt: (d.last_seen_at as string | null) ?? null,
  }));
}

export async function deleteKioskDevice(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("kiosk_device").delete().eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/** True when the token matches a registered kiosk device (and bumps last_seen_at). */
export async function verifyKioskToken(
  token: string | undefined,
  db?: SupabaseClient,
): Promise<boolean> {
  if (!token) return false;
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("kiosk_device")
    .select("id")
    .eq("token_hash", hashKioskToken(token))
    .maybeSingle();
  if (!data) return false;
  await client
    .from("kiosk_device")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return true;
}
```

Run: `./dev npm run test` → kiosk suite passes.

- [ ] **Step 3: Write the failing sessions test (pure-ish shape via injected db)**

Create `src/lib/sessions.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { clockIn } from "./sessions";

// Minimal fake db capturing the insert; getActivePeriod resolves to a period.
function fakeDb(opts: { activePeriod: { id: string } | null; insertError?: { code: string } }) {
  return {
    from(table: string) {
      if (table === "period") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.activePeriod, error: null }) }),
          }),
        };
      }
      // session
      return {
        insert: async () => ({ error: opts.insertError ?? null }),
      };
    },
  } as never;
}

describe("clockIn", () => {
  test("409 no_active_period when no active period", async () => {
    const r = await clockIn("p1", fakeDb({ activePeriod: null }));
    expect(r).toEqual({ ok: false, status: 409, reason: "no_active_period" });
  });
  test("409 already_in on unique violation (23505)", async () => {
    const r = await clockIn("p1", fakeDb({ activePeriod: { id: "pd1" }, insertError: { code: "23505" } }));
    expect(r).toEqual({ ok: false, status: 409, reason: "already_in" });
  });
  test("ok when insert succeeds", async () => {
    const r = await clockIn("p1", fakeDb({ activePeriod: { id: "pd1" } }));
    expect(r).toEqual({ ok: true });
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 4: Implement `src/lib/sessions.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActivePeriod } from "./periods";
import { displayName } from "./people";

export type ClockResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

const UNIQUE_VIOLATION = "23505";

export async function clockIn(personId: string, db?: SupabaseClient): Promise<ClockResult> {
  const client = db ?? (await import("./db")).getDb();
  const period = await getActivePeriod(client);
  if (!period) return { ok: false, status: 409, reason: "no_active_period" };
  const { error } = await client
    .from("session")
    .insert({ person_id: personId, period_id: period.id, source: "kiosk" });
  if (error) {
    // The partial unique index rejects a second open session for the same person.
    if (error.code === UNIQUE_VIOLATION) return { ok: false, status: 409, reason: "already_in" };
    return { ok: false, status: 500, reason: "db_error" };
  }
  return { ok: true };
}

export async function clockOut(personId: string, db?: SupabaseClient): Promise<ClockResult> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("session")
    .update({ time_out: new Date().toISOString() })
    .eq("person_id", personId)
    .is("time_out", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, reason: "db_error" };
  if (!data) return { ok: false, status: 404, reason: "not_in" };
  return { ok: true };
}

export type WhosHereEntry = { personId: string; name: string; since: string };

export async function listWhosHere(db?: SupabaseClient): Promise<WhosHereEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("session")
    .select("time_in, person (id, first_name, last_name, display_name)")
    .is("time_out", null)
    .order("time_in");
  return (data ?? [])
    .filter((r) => r.person)
    .map((r) => {
      const p = r.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      return { personId: p.id, name: displayName(p), since: r.time_in as string };
    });
}

/** Active members not currently clocked in — the kiosk sign-in grid. */
export async function activeMembersForKiosk(
  db?: SupabaseClient,
): Promise<{ id: string; name: string }[]> {
  const client = db ?? (await import("./db")).getDb();
  const [{ data: people }, { data: open }] = await Promise.all([
    client.from("person").select("id, first_name, last_name, display_name").eq("is_active", true),
    client.from("session").select("person_id").is("time_out", null),
  ]);
  const openIds = new Set((open ?? []).map((s) => s.person_id as string));
  return (people ?? [])
    .filter((p) => !openIds.has(p.id as string))
    .map((p) => ({
      id: p.id as string,
      name: displayName(p as unknown as { first_name: string; last_name: string; display_name: string | null }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 5: Admin kiosk-device routes**

Create `src/app/api/admin/kiosk-devices/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createKioskDevice } from "@/lib/kiosk";
import { reqString } from "@/lib/validate";

export const POST = withRole("admin", async (viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = reqString(body?.name, 80);
  if (!name) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createKioskDevice(name, viewer.person!.id);
  if (!result) return Response.json({ error: "failed" }, { status: 500 });
  // The plaintext token is returned ONCE; only its hash is stored.
  return Response.json({ id: result.id, token: result.token }, { status: 201 });
});
```

Create `src/app/api/admin/kiosk-devices/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { deleteKioskDevice } from "@/lib/kiosk";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteKioskDevice(id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 6: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live authz:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/kiosk-devices -H 'Content-Type: application/json' -d '{\"name\":\"x\"}'"   # 403 anonymous
```

```bash
git add -A && git commit -m "feat: add kiosk device tokens and session clock library" && git push
```

---

### Task 5: Kiosk page, setup, and clock routes

**Files:**
- Create: `src/app/api/kiosk/clock-in/route.ts`
- Create: `src/app/api/kiosk/clock-out/route.ts`
- Create: `src/app/api/kiosk/setup/route.ts`
- Create: `src/app/kiosk/page.tsx`
- Create: `src/app/kiosk/setup/page.tsx`
- Create: `src/components/KioskBoard.tsx`
- Create: `src/lib/kiosk-request.ts`; Test: `src/lib/kiosk-request.test.ts`

**Interfaces:**
- Consumes: `verifyKioskToken`/`KIOSK_COOKIE` (Task 4), `clockIn`/`clockOut`/`listWhosHere`/`activeMembersForKiosk` (Task 4), `createRateLimiter`/`clientIp` (M2).
- Produces:
  - `kioskTokenFromRequest(request: Request): string | undefined` — reads the `hub_kiosk_token` cookie from the request. PURE (parses the Cookie header).
  - `POST /api/kiosk/setup` `{ token }` → validates via `verifyKioskToken`, sets the long-lived httpOnly kiosk cookie (200) or 401.
  - `POST /api/kiosk/clock-in` `{ personId }` and `POST /api/kiosk/clock-out` `{ personId }` → require a valid kiosk cookie (401 otherwise), rate-limited, call clockIn/clockOut.
  - `/kiosk` — full-screen board; if no valid kiosk cookie, links to `/kiosk/setup`.
  - `/kiosk/setup` — token entry form.

- [ ] **Step 1: Write the failing cookie-parse test**

Create `src/lib/kiosk-request.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { kioskTokenFromRequest } from "./kiosk-request";

describe("kioskTokenFromRequest", () => {
  test("extracts the kiosk cookie value", () => {
    const req = new Request("http://test/", {
      headers: { cookie: "other=1; hub_kiosk_token=abc.def; x=2" },
    });
    expect(kioskTokenFromRequest(req)).toBe("abc.def");
  });
  test("undefined when absent", () => {
    expect(kioskTokenFromRequest(new Request("http://test/"))).toBeUndefined();
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/kiosk-request.ts`**

```ts
import { KIOSK_COOKIE } from "./kiosk";

/** Read the kiosk device token from the request's Cookie header. PURE. */
export function kioskTokenFromRequest(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === KIOSK_COOKIE) return rest.join("=");
  }
  return undefined;
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Setup route `src/app/api/kiosk/setup/route.ts`**

```ts
import { NextResponse } from "next/server";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { createRateLimiter, clientIp } from "@/lib/rate-limit";

const setupLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!setupLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || !(await verifyKioskToken(token))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // a year — this is a fixed shop tablet
    path: "/",
  });
  return response;
}
```

- [ ] **Step 4: Clock routes**

Create `src/app/api/kiosk/clock-in/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyKioskToken } from "@/lib/kiosk";
import { kioskTokenFromRequest } from "@/lib/kiosk-request";
import { clockIn } from "@/lib/sessions";
import { reqString } from "@/lib/validate";
import { createRateLimiter, clientIp } from "@/lib/rate-limit";

const clockLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!clockLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  if (!(await verifyKioskToken(kioskTokenFromRequest(request)))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { personId?: unknown } | null;
  const personId = reqString(body?.personId, 64);
  if (!personId) return NextResponse.json({ ok: false }, { status: 400 });
  const result = await clockIn(personId);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/kiosk/clock-out/route.ts` (identical shape, calling `clockOut`):

```ts
import { NextResponse } from "next/server";
import { verifyKioskToken } from "@/lib/kiosk";
import { kioskTokenFromRequest } from "@/lib/kiosk-request";
import { clockOut } from "@/lib/sessions";
import { reqString } from "@/lib/validate";
import { createRateLimiter, clientIp } from "@/lib/rate-limit";

const clockLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!clockLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  if (!(await verifyKioskToken(kioskTokenFromRequest(request)))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { personId?: unknown } | null;
  const personId = reqString(body?.personId, 64);
  if (!personId) return NextResponse.json({ ok: false }, { status: 400 });
  const result = await clockOut(personId);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Setup page + board component + kiosk page**

Create `src/app/kiosk/setup/page.tsx`:

```tsx
import { KioskSetupForm } from "@/components/KioskBoard";

export default function KioskSetupPage() {
  return (
    <main>
      <h1>Kiosk setup</h1>
      <p>Enter the kiosk token from an admin (Admin → Kiosk devices) to register this tablet.</p>
      <KioskSetupForm />
    </main>
  );
}
```

Create `src/components/KioskBoard.tsx` (both client components live here):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function KioskSetupForm() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch("/api/kiosk/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) { router.push("/kiosk"); router.refresh(); }
    else setStatus("Token not recognized.");
  }
  return (
    <form onSubmit={submit}>
      <label>Kiosk token <input value={token} onChange={(e) => setToken(e.target.value)} required /></label>
      <button type="submit">Register this tablet</button>
      {status && <p role="alert">{status}</p>}
    </form>
  );
}

type Member = { id: string; name: string };
type Here = { personId: string; name: string; since: string };

export function KioskBoard({ members, here }: { members: Member[]; here: Here[] }) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const router = useRouter();

  async function call(path: string, personId: string, name: string, verb: string) {
    if (busy) return;
    setBusy(true);
    setFlash(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId }),
    });
    setBusy(false);
    if (res.ok) { setFlash(`${verb} ${name}`); router.refresh(); }
    else if (res.status === 401) { setFlash("This tablet is not registered."); }
    else {
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      setFlash(data.reason === "no_active_period" ? "No active period — ask a mentor." : "Try again.");
    }
  }

  return (
    <div>
      {flash && <p role="status">{flash}</p>}
      <section>
        <h2>Who&apos;s here ({here.length})</h2>
        <ul>
          {here.map((h) => (
            <li key={h.personId}>
              <button onClick={() => call("/api/kiosk/clock-out", h.personId, h.name, "Signed out")}>
                {h.name} — out
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Sign in</h2>
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              <button onClick={() => call("/api/kiosk/clock-in", m.id, m.name, "Signed in")}>
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

Create `src/app/kiosk/page.tsx`:

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { activeMembersForKiosk, listWhosHere } from "@/lib/sessions";
import { KioskBoard } from "@/components/KioskBoard";

export default async function KioskPage() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (!(await verifyKioskToken(token))) {
    return (
      <main>
        <h1>Kiosk</h1>
        <p>This tablet isn&apos;t registered. <Link href="/kiosk/setup">Set it up</Link>.</p>
      </main>
    );
  }
  const [members, here] = await Promise.all([activeMembersForKiosk(), listWhosHere()]);
  return (
    <main>
      <h1>Sign in / out</h1>
      <KioskBoard members={members} here={here} />
    </main>
  );
}
```

- [ ] **Step 6: Verify — including a real kiosk round-trip**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live end-to-end (dev server up, `db:reset` applied → seeded Test Student `1741` + active period). Create a kiosk device via SQL (no admin session needed), register it, clock the seeded student in and out:

```bash
# make a kiosk device with a known token by inserting its hash directly
TOKEN="test-kiosk-token-123"
HASH=$(./dev bash -lc "node -e \"console.log(require('crypto').createHash('sha256').update('$TOKEN').digest('hex'))\"")
./dev npm run db:psql -- -c "insert into kiosk_device (name, token_hash) values ('Test Tablet', '$HASH');"
# register the tablet (sets the cookie jar)
./dev bash -lc "curl -s -c /tmp/kiosk -X POST http://localhost:3000/api/kiosk/setup -H 'Content-Type: application/json' -d '{\"token\":\"$TOKEN\"}' -o /dev/null -w '%{http_code}\n'"   # 200
# find the seeded student's id
./dev npm run db:psql -- -c "select id from person where student_id_number='1741';"   # note <pid>
# clock in, then a second clock-in must 409 already_in
./dev bash -lc "curl -s -b /tmp/kiosk -X POST http://localhost:3000/api/kiosk/clock-in -H 'Content-Type: application/json' -d '{\"personId\":\"<pid>\"}' -o /dev/null -w '%{http_code}\n'"   # 200
./dev bash -lc "curl -s -b /tmp/kiosk -X POST http://localhost:3000/api/kiosk/clock-in -H 'Content-Type: application/json' -d '{\"personId\":\"<pid>\"}' -o /dev/null -w '%{http_code}\n'"   # 409
./dev npm run db:psql -- -c "select count(*) from session where time_out is null;"   # 1
# clock out
./dev bash -lc "curl -s -b /tmp/kiosk -X POST http://localhost:3000/api/kiosk/clock-out -H 'Content-Type: application/json' -d '{\"personId\":\"<pid>\"}' -o /dev/null -w '%{http_code}\n'"   # 200
./dev npm run db:psql -- -c "select count(*) from session where time_out is null;"   # 0
# unregistered request is rejected
./dev bash -lc "curl -s -X POST http://localhost:3000/api/kiosk/clock-in -H 'Content-Type: application/json' -d '{\"personId\":\"<pid>\"}' -o /dev/null -w '%{http_code}\n'"   # 401
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add kiosk page, setup, and clock in/out routes" && git push
```

---

### Task 6: Dashboard who's-here, leaderboard, per-member hours

**Files:**
- Create: `src/app/api/whos-here/route.ts`
- Create: `src/components/WhosHere.tsx`
- Modify: `src/app/page.tsx` (add who's-here + hours summary for signed-in viewers)
- Create: `src/app/leaderboard/page.tsx`
- Create: `src/lib/reports.ts`; Test: `src/lib/reports.test.ts`
- Modify: `src/app/people/[id]/page.tsx` (add sessions + hours for self/mentor+)

**Interfaces:**
- Consumes: `listWhosHere` (Task 4), `getActivePeriod` (Task 3), `totalHours`/`sessionHours` (Task 2), `getViewer`, `hasRole`, `canViewProfile` (people), `displayName`, `getSetting`.
- Produces:
  - `type LeaderboardEntry = { personId: string; name: string; hours: number; sessionCount: number }`
  - `leaderboard(rows: { personId: string; name: string; sessions: Session[] }[]): LeaderboardEntry[]` — PURE; totals per person, sorted desc by hours.
  - `periodLeaderboard(periodId: string, db?): Promise<LeaderboardEntry[]>`
  - `personSessions(personId: string, periodId: string, db?): Promise<Session[]>`

- [ ] **Step 1: Write the failing leaderboard test**

Create `src/lib/reports.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { leaderboard } from "./reports";
import type { Session } from "./types";

const s = (over: Partial<Session>): Session => ({
  id: "s", personId: "p", periodId: "pd", timeIn: "2026-09-01T18:00:00Z",
  timeOut: "2026-09-01T20:00:00Z", source: "kiosk", note: null,
  excludedFromTotals: false, editedBy: null, editedAt: null, ...over,
});

describe("leaderboard", () => {
  test("totals per person, sorted by hours desc", () => {
    const result = leaderboard([
      { personId: "p1", name: "Ada", sessions: [s({}), s({ timeOut: "2026-09-01T21:00:00Z" })] }, // 2 + 3 = 5
      { personId: "p2", name: "Bo", sessions: [s({})] }, // 2
    ]);
    expect(result).toEqual([
      { personId: "p1", name: "Ada", hours: 5, sessionCount: 2 },
      { personId: "p2", name: "Bo", hours: 2, sessionCount: 1 },
    ]);
  });
  test("excluded and open sessions don't add hours but count as sessions", () => {
    const [entry] = leaderboard([
      { personId: "p1", name: "Ada", sessions: [s({ excludedFromTotals: true }), s({ timeOut: null })] },
    ]);
    expect(entry.hours).toBe(0);
    expect(entry.sessionCount).toBe(2);
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/reports.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, SessionRow } from "./types";
import { sessionFromRow } from "./types";
import { totalHours } from "./hours";
import { displayName } from "./people";

export type LeaderboardEntry = {
  personId: string;
  name: string;
  hours: number;
  sessionCount: number;
};

/** Per-person totals, sorted by hours desc then name. PURE. */
export function leaderboard(
  rows: { personId: string; name: string; sessions: Session[] }[],
): LeaderboardEntry[] {
  return rows
    .map((r) => ({
      personId: r.personId,
      name: r.name,
      hours: Math.round(totalHours(r.sessions) * 100) / 100,
      sessionCount: r.sessions.length,
    }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}

export async function personSessions(
  personId: string,
  periodId: string,
  db?: SupabaseClient,
): Promise<Session[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("session")
    .select("*")
    .eq("person_id", personId)
    .eq("period_id", periodId)
    .order("time_in", { ascending: false });
  return ((data ?? []) as SessionRow[]).map(sessionFromRow);
}

export async function periodLeaderboard(
  periodId: string,
  db?: SupabaseClient,
): Promise<LeaderboardEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("session")
    .select("*, person (id, first_name, last_name, display_name)")
    .eq("period_id", periodId);
  const byPerson = new Map<string, { name: string; sessions: Session[] }>();
  for (const row of data ?? []) {
    const p = row.person as unknown as {
      id: string; first_name: string; last_name: string; display_name: string | null;
    } | null;
    if (!p) continue;
    const entry = byPerson.get(p.id) ?? { name: displayName(p), sessions: [] };
    entry.sessions.push(sessionFromRow(row as unknown as SessionRow));
    byPerson.set(p.id, entry);
  }
  return leaderboard(
    [...byPerson.entries()].map(([personId, v]) => ({ personId, name: v.name, sessions: v.sessions })),
  );
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Who's-here API + poll component**

Create `src/app/api/whos-here/route.ts`:

```ts
import { getViewer } from "@/lib/viewer";
import { listWhosHere } from "@/lib/sessions";

export async function GET() {
  // Open to any viewer including guests (names only — same scope as the roster).
  await getViewer();
  const here = await listWhosHere();
  return Response.json({ here: here.map((h) => ({ name: h.name, since: h.since })) });
}
```

Create `src/components/WhosHere.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Entry = { name: string; since: string };

export function WhosHere({ initial }: { initial: Entry[] }) {
  const [here, setHere] = useState<Entry[]>(initial);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/whos-here", { cache: "no-store" });
        if (res.ok) setHere(((await res.json()).here as Entry[]) ?? []);
      } catch {
        // transient; keep last known list
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section>
      <h2>In the shop ({here.length})</h2>
      {here.length === 0 ? (
        <p>Nobody is signed in.</p>
      ) : (
        <ul>
          {here.map((h) => (
            <li key={`${h.name}-${h.since}`}>
              {h.name} — since {new Date(h.since).toLocaleTimeString()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Home page — add who's-here + current-period hours summary**

In `src/app/page.tsx`, inside the signed-in branch (below the existing links list), add a server-rendered who's-here seed + the poll component and a hours line. Add these imports at the top: `import { WhosHere } from "@/components/WhosHere";`, `import { listWhosHere } from "@/lib/sessions";`, `import { getActivePeriod } from "@/lib/periods";`, `import { periodLeaderboard } from "@/lib/reports";`. Change the component to fetch before rendering:

```tsx
// inside HomePage(), after `const viewer = await getViewer();`
const here = viewer.person ? await listWhosHere() : [];
const activePeriod = viewer.person ? await getActivePeriod() : null;
const myHours =
  viewer.person && activePeriod
    ? (await periodLeaderboard(activePeriod.id)).find((e) => e.personId === viewer.person!.id)?.hours ?? 0
    : 0;
```

Then in the signed-in JSX branch, render:

```tsx
{activePeriod && (
  <p>
    {activePeriod.name}: you have <strong>{myHours}</strong> h.
  </p>
)}
<WhosHere initial={here.map((h) => ({ name: h.name, since: h.since }))} />
```

- [ ] **Step 5: Leaderboard page `src/app/leaderboard/page.tsx`**

```tsx
import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { getActivePeriod, listPeriods } from "@/lib/periods";
import { periodLeaderboard } from "@/lib/reports";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ period }, viewer, periods] = await Promise.all([
    searchParams, getViewer(), listPeriods(),
  ]);
  void viewer; // open to guests: hours + names only, no contact detail
  const active = await getActivePeriod();
  const periodId = period ?? active?.id ?? periods[0]?.id;
  const entries = periodId ? await periodLeaderboard(periodId) : [];

  return (
    <main>
      <h1>Leaderboard</h1>
      <form method="get">
        <label>Period{" "}
          <select name="period" defaultValue={periodId ?? ""}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.isActive ? " (active)" : ""}</option>
            ))}
          </select>
        </label>
        <button type="submit">View</button>
      </form>
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Hours</th><th>Sessions</th></tr></thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.personId}>
              <td>{i + 1}</td>
              <td><Link href={`/people/${e.personId}`}>{e.name}</Link></td>
              <td>{e.hours}</td>
              <td>{e.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

(Profile links only resolve for self/mentor+ via `canViewProfile`; a guest clicking one gets the existing `notFound()`.)

- [ ] **Step 6: Per-member sessions + hours on the profile page**

In `src/app/people/[id]/page.tsx`, after the existing Teams section, add sessions for the active period (the page is already gated by `canViewProfile`, so only self/mentor+ reach it). Add imports: `import { getActivePeriod } from "@/lib/periods";`, `import { personSessions } from "@/lib/reports";`, `import { sessionHours, totalHours } from "@/lib/hours";`. After `const { person, teams } = result;` add:

```tsx
const activePeriod = await getActivePeriod();
const sessions = activePeriod ? await personSessions(person.id, activePeriod.id) : [];
```

Then before `</main>` render:

```tsx
<h2>Hours{activePeriod ? ` — ${activePeriod.name}` : ""}</h2>
<p>Total: <strong>{Math.round(totalHours(sessions) * 100) / 100}</strong> h across {sessions.length} sessions.</p>
<table>
  <thead><tr><th>In</th><th>Out</th><th>Hours</th><th>Source</th><th>Excluded</th></tr></thead>
  <tbody>
    {sessions.map((s) => (
      <tr key={s.id}>
        <td>{new Date(s.timeIn).toLocaleString()}</td>
        <td>{s.timeOut ? new Date(s.timeOut).toLocaleString() : "— open —"}</td>
        <td>{s.timeOut ? Math.round(sessionHours(s) * 100) / 100 : ""}</td>
        <td>{s.source}</td>
        <td>{s.excludedFromTotals ? "yes" : ""}</td>
      </tr>
    ))}
  </tbody>
</table>
```

- [ ] **Step 7: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live (dev server up; use the kiosk round-trip from Task 6 to create a closed session first):

```bash
./dev bash -lc "curl -s http://localhost:3000/api/whos-here"                         # {"here":[...]}
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/leaderboard"   # 200 (guest OK)
```

```bash
git add -A && git commit -m "feat: add who's-here poll, leaderboard, and per-member hours" && git push
```

---

### Task 7: Flagged sessions review + manual session edits

**Files:**
- Modify: `src/lib/reports.ts` (add `listAllSessionsForPeriod`, flag assembly); Test: extend `src/lib/reports.test.ts`
- Create: `src/lib/session-edit.ts`; Test: `src/lib/session-edit.test.ts`
- Create: `src/app/api/admin/sessions/route.ts` (manual add)
- Create: `src/app/api/admin/sessions/[id]/route.ts` (edit / delete)
- Create: `src/components/SessionEditRow.tsx`
- Create: `src/app/admin/sessions/flagged/page.tsx`

**Interfaces:**
- Consumes: `withRole<C>`, `optString`, `sessionFlags`/`overlappingSessionIds`/`FlagKind` (Task 2), `getActivePeriod`, `getSetting`, `sessionFromRow`.
- Produces:
  - `parseSessionEdit(body): { timeIn: string; timeOut: string | null; note: string | null; excludedFromTotals: boolean } | null` — PURE; ISO datetimes; timeOut optional; timeOut (if present) ≥ timeIn.
  - `parseManualSession(body): { personId: string; timeIn: string; timeOut: string | null; note: string | null } | null` — PURE.
  - `updateSession(id, edit, editorId, db?)` — sets fields + `edited_by`, `edited_at` (404 miss).
  - `deleteSession(id, db?)`; `createManualSession(input, editorId, periodId, db?)`.
  - `type FlaggedSession = { session: Session; name: string; flags: FlagKind[]; overlapping: boolean }`
  - `flaggedSessions(periodId, db?): Promise<FlaggedSession[]>` — assembles per-session flags (incl. overlap) for sessions that have ≥1 flag.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/session-edit.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseManualSession, parseSessionEdit } from "./session-edit";

describe("parseSessionEdit", () => {
  test("accepts closed edit", () => {
    expect(
      parseSessionEdit({
        timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T20:00:00Z",
        note: " late ", excludedFromTotals: true,
      }),
    ).toEqual({
      timeIn: "2026-09-01T18:00:00.000Z", timeOut: "2026-09-01T20:00:00.000Z",
      note: "late", excludedFromTotals: true,
    });
  });
  test("accepts open edit (null timeOut)", () => {
    const r = parseSessionEdit({ timeIn: "2026-09-01T18:00:00Z", excludedFromTotals: false });
    expect(r?.timeOut).toBeNull();
  });
  test.each([
    [{ timeIn: "nope", excludedFromTotals: false }],
    [{ timeIn: "2026-09-01T20:00:00Z", timeOut: "2026-09-01T18:00:00Z", excludedFromTotals: false }], // out before in
    [{ excludedFromTotals: false }],
    [null],
  ])("rejects %j", (b) => expect(parseSessionEdit(b)).toBeNull());
});

describe("parseManualSession", () => {
  test("requires personId and timeIn", () => {
    expect(parseManualSession({ personId: "p1", timeIn: "2026-09-01T18:00:00Z" })).toEqual({
      personId: "p1", timeIn: "2026-09-01T18:00:00.000Z", timeOut: null, note: null,
    });
  });
  test.each([[{ timeIn: "2026-09-01T18:00:00Z" }], [{ personId: "p1" }], [null]])(
    "rejects %j",
    (b) => expect(parseManualSession(b)).toBeNull(),
  );
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/session-edit.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { optString, reqString } from "./validate";

function isoOrNull(v: unknown): string | null | undefined {
  // undefined = absent; null-return = invalid; string = normalized ISO
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

export type SessionEdit = {
  timeIn: string;
  timeOut: string | null;
  note: string | null;
  excludedFromTotals: boolean;
};

export function parseSessionEdit(body: unknown): SessionEdit | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const timeIn = typeof b.timeIn === "string" && !Number.isNaN(Date.parse(b.timeIn))
    ? new Date(b.timeIn).toISOString()
    : null;
  if (!timeIn) return null;
  const timeOut = isoOrNull(b.timeOut);
  if (timeOut === undefined) return null; // present but invalid
  if (timeOut && Date.parse(timeOut) < Date.parse(timeIn)) return null;
  const note = optString(b.note, 500);
  if (!note) return null;
  const excludedFromTotals = typeof b.excludedFromTotals === "boolean" ? b.excludedFromTotals : null;
  if (excludedFromTotals === null) return null;
  return { timeIn, timeOut, note: note.value, excludedFromTotals };
}

export type ManualSession = {
  personId: string;
  timeIn: string;
  timeOut: string | null;
  note: string | null;
};

export function parseManualSession(body: unknown): ManualSession | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const personId = reqString(b.personId, 64);
  const timeIn = typeof b.timeIn === "string" && !Number.isNaN(Date.parse(b.timeIn))
    ? new Date(b.timeIn).toISOString()
    : null;
  if (!personId || !timeIn) return null;
  const timeOut = isoOrNull(b.timeOut);
  if (timeOut === undefined) return null;
  if (timeOut && Date.parse(timeOut) < Date.parse(timeIn)) return null;
  const note = optString(b.note, 500);
  if (!note) return null;
  return { personId, timeIn, timeOut, note: note.value };
}

export async function updateSession(
  id: string,
  edit: SessionEdit,
  editorId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("session")
    .update({
      time_in: edit.timeIn,
      time_out: edit.timeOut,
      note: edit.note,
      excluded_from_totals: edit.excludedFromTotals,
      edited_by: editorId,
      edited_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteSession(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("session").delete().eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function createManualSession(
  input: ManualSession,
  editorId: string,
  periodId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("session").insert({
    person_id: input.personId,
    period_id: periodId,
    time_in: input.timeIn,
    time_out: input.timeOut,
    note: input.note,
    source: "manual",
    edited_by: editorId,
    edited_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, status: 409 }; // would create a 2nd open session
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Add `flaggedSessions` to `src/lib/reports.ts`**

Append:

```ts
import { overlappingSessionIds, sessionFlags, type FlagKind } from "./hours";
import { getSetting } from "./settings";

export type FlaggedSession = {
  session: Session;
  name: string;
  flags: FlagKind[];
  overlapping: boolean;
};

export async function flaggedSessions(
  periodId: string,
  db?: SupabaseClient,
): Promise<FlaggedSession[]> {
  const client = db ?? (await import("./db")).getDb();
  const maxShift = await getSetting<number>("max_shift_hours", 18, client);
  const { data } = await client
    .from("session")
    .select("*, person (id, first_name, last_name, display_name)")
    .eq("period_id", periodId)
    .order("time_in", { ascending: false });

  const sessions = (data ?? []).map((r) => sessionFromRow(r as unknown as SessionRow));
  const overlaps = overlappingSessionIds(sessions);
  const nameById = new Map<string, string>();
  for (const r of data ?? []) {
    const p = r.person as unknown as {
      id: string; first_name: string; last_name: string; display_name: string | null;
    } | null;
    if (p) nameById.set(p.id, displayName(p));
  }

  const out: FlaggedSession[] = [];
  for (const s of sessions) {
    const flags = sessionFlags(s, maxShift);
    const overlapping = overlaps.has(s.id);
    if (flags.length === 0 && !overlapping) continue;
    out.push({ session: s, name: nameById.get(s.personId) ?? "Unknown", flags, overlapping });
  }
  return out;
}
```

- [ ] **Step 4: Routes**

Create `src/app/api/admin/sessions/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createManualSession, parseManualSession } from "@/lib/session-edit";
import { getActivePeriod } from "@/lib/periods";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseManualSession(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const period = await getActivePeriod();
  if (!period) return Response.json({ error: "no_active_period" }, { status: 409 });
  const result = await createManualSession(input, viewer.person!.id, period.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

Create `src/app/api/admin/sessions/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { deleteSession, parseSessionEdit, updateSession } from "@/lib/session-edit";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("mentor", async (viewer, request, context) => {
  const { id } = await context.params;
  const edit = parseSessionEdit(await request.json().catch(() => null));
  if (!edit) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateSession(id, edit, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteSession(id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
```

(Note: session review is `withRole("mentor", ...)` — mentors and admins, not students/captains.)

- [ ] **Step 5: Edit-row component + flagged page**

Create `src/components/SessionEditRow.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local wants YYYY-MM-DDTHH:mm in local time
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionEditRow({
  id, timeIn, timeOut, note, excluded, label,
}: {
  id: string; timeIn: string; timeOut: string | null; note: string | null;
  excluded: boolean; label: string;
}) {
  const [tin, setTin] = useState(toLocalInput(timeIn));
  const [tout, setTout] = useState(toLocalInput(timeOut));
  const [n, setN] = useState(note ?? "");
  const [exc, setExc] = useState(excluded);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function save() {
    setStatus(null);
    const res = await fetch(`/api/admin/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeIn: new Date(tin).toISOString(),
        timeOut: tout ? new Date(tout).toISOString() : null,
        note: n || undefined,
        excludedFromTotals: exc,
      }),
    });
    if (res.ok) { setStatus("Saved."); router.refresh(); }
    else setStatus("Save failed.");
  }
  async function remove() {
    if (!confirm(`Delete this session for ${label}?`)) return;
    const res = await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else setStatus("Delete failed.");
  }

  return (
    <tr>
      <td>{label}</td>
      <td><input type="datetime-local" value={tin} onChange={(e) => setTin(e.target.value)} /></td>
      <td><input type="datetime-local" value={tout} onChange={(e) => setTout(e.target.value)} /></td>
      <td><input value={n} onChange={(e) => setN(e.target.value)} placeholder="note" /></td>
      <td><input type="checkbox" checked={exc} onChange={(e) => setExc(e.target.checked)} /></td>
      <td>
        <button onClick={save}>Save</button>{" "}
        <button onClick={remove}>Delete</button>
        {status && <span role="status"> {status}</span>}
      </td>
    </tr>
  );
}
```

Create `src/app/admin/sessions/flagged/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { flaggedSessions } from "@/lib/reports";
import { SessionEditRow } from "@/components/SessionEditRow";

export default async function FlaggedSessionsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/login");

  const period = await getActivePeriod();
  const flagged = period ? await flaggedSessions(period.id) : [];

  return (
    <main>
      <h1>Flagged sessions{period ? ` — ${period.name}` : ""}</h1>
      <p>Over {`${18}`}h, still open, auto-closed by the nightly sweep, or overlapping another session.</p>
      {flagged.length === 0 ? (
        <p>Nothing flagged. 🎉</p>
      ) : (
        <table>
          <thead>
            <tr><th>Member</th><th>In</th><th>Out</th><th>Note</th><th>Excl.</th><th>Flags / actions</th></tr>
          </thead>
          <tbody>
            {flagged.map((f) => (
              <SessionEditRow
                key={f.session.id}
                id={f.session.id}
                timeIn={f.session.timeIn}
                timeOut={f.session.timeOut}
                note={f.session.note}
                excluded={f.session.excludedFromTotals}
                label={`${f.name} [${[...f.flags, ...(f.overlapping ? ["overlap"] : [])].join(", ")}]`}
              />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live authz:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/sessions -H 'Content-Type: application/json' -d '{}'"   # 403 anonymous
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/sessions/flagged"   # 307
```

```bash
git add -A && git commit -m "feat: add flagged-sessions review and manual session edits" && git push
```

---

### Task 8: Nightly sweep (pg_cron) + manual run

**Files:**
- Create: `supabase/migrations/<timestamp>_session_sweep.sql`
- Create: `src/app/api/admin/sessions/run-sweep/route.ts`
- Modify: `supabase/README.md` (document the cron job + how to run the sweep manually)

**Interfaces:**
- Consumes: `withRole`, `getDb().rpc(...)`.
- Produces: SQL function `close_stale_sessions()` (timezone-aware; closes previous-day open sessions), a pg_cron schedule, and an admin route `POST /api/admin/sessions/run-sweep` (mentor) that invokes the function via RPC.

- [ ] **Step 1: Create the migration**

```bash
./dev npx supabase migration new session_sweep
```

Fill `supabase/migrations/<timestamp>_session_sweep.sql`:

```sql
-- Timezone-aware forgotten-sign-out heal. Closes sessions still open from a
-- PREVIOUS local day, backdating time_out to time_in + auto_close_hours so a
-- forgotten sign-out doesn't record an all-night shift. Marks edited_at (with
-- edited_by NULL = system) so the flagged screen surfaces it for review.
create or replace function close_stale_sessions()
returns integer
language plpgsql
security definer
as $$
declare
  tz text;
  close_hours numeric;
  today_start timestamptz;
  closed_count integer;
begin
  select coalesce(value #>> '{}', 'America/Indiana/Indianapolis') into tz
    from app_setting where key = 'team_timezone';
  if tz is null then tz := 'America/Indiana/Indianapolis'; end if;

  select coalesce((value #>> '{}')::numeric, 4) into close_hours
    from app_setting where key = 'auto_close_hours';
  if close_hours is null then close_hours := 4; end if;

  -- Start of the current day in the team timezone, as a UTC instant.
  today_start := date_trunc('day', now() at time zone tz) at time zone tz;

  update session
     set time_out = time_in + (close_hours * interval '1 hour'),
         edited_at = now()          -- edited_by stays NULL: this is a system close
   where time_out is null
     and time_in < today_start;

  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

-- Schedule the sweep once daily at 08:00 UTC (~3-4am US Eastern year-round, well
-- after the shop closes). pg_cron runs in UTC; the function itself does the
-- timezone conversion, so the exact UTC hour only needs to land in the early
-- local morning.
create extension if not exists pg_cron;
select cron.schedule('close-stale-sessions', '0 8 * * *', 'select close_stale_sessions();');
```

**Local pg_cron note:** the Supabase local image bundles `pg_cron`. If `create extension pg_cron` or `cron.schedule` errors in the local stack, comment out ONLY the last two lines (extension + schedule), keep the function, and record it in the report — the function is still testable via the manual route below, and the schedule lines apply on the hosted project in M4. Do not remove the function.

- [ ] **Step 2: Apply and verify the function directly**

```bash
./dev npm run db:reset
# open a session backdated to "yesterday" for the seeded student, then sweep it
./dev npm run db:psql -- -c "insert into session (person_id, period_id, time_in) select p.id, pd.id, now() - interval '2 days' from person p, period pd where p.student_id_number='1741' and pd.is_active limit 1;"
./dev npm run db:psql -- -c "select close_stale_sessions();"                     # returns 1
./dev npm run db:psql -- -c "select time_out is not null as closed, edited_by is null as system_closed from session order by created_at desc limit 1;"   # t | t
# a session started TODAY (local) must NOT be swept
./dev npm run db:psql -- -c "delete from session;"
./dev npm run db:psql -- -c "insert into session (person_id, period_id) select p.id, pd.id from person p, period pd where p.student_id_number='1741' and pd.is_active limit 1;"
./dev npm run db:psql -- -c "select close_stale_sessions();"                     # returns 0
./dev npm run db:psql -- -c "select cron.jobname from cron.job;" 2>&1 | tail -3  # close-stale-sessions (or note if pg_cron unavailable locally)
```

Expected: the 2-days-old open session is closed by the sweep (returns 1, closed & system-closed); today's open session is left alone (returns 0).

- [ ] **Step 3: Manual-run admin route**

Create `src/app/api/admin/sessions/run-sweep/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";

// Manual trigger for the nightly sweep — useful for "close everyone out now"
// and for testing without waiting for cron.
export const POST = withRole("mentor", async () => {
  const { data, error } = await getDb().rpc("close_stale_sessions");
  if (error) return Response.json({ error: "failed" }, { status: 500 });
  return Response.json({ closed: data as number });
});
```

- [ ] **Step 4: Document in `supabase/README.md`**

Add a short "Nightly session sweep" section: what `close_stale_sessions()` does, that it's scheduled via pg_cron at 08:00 UTC, that it's timezone-aware via the `team_timezone` setting, and that `POST /api/admin/sessions/run-sweep` (mentor+) runs it on demand.

- [ ] **Step 5: Verify + commit**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/sessions/run-sweep"   # 403 anonymous
```

```bash
git add -A && git commit -m "feat: add nightly session sweep (pg_cron) and manual run route" && git push
```

---

### Task 9: Navigation, kiosk-device admin page, docs

**Files:**
- Modify: `src/components/SiteNav.tsx` (add Kiosk, Leaderboard; admin Periods/Sessions/Kiosk links)
- Create: `src/app/admin/kiosk-devices/page.tsx`
- Create: `src/components/KioskDeviceManager.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `getViewer`, `hasRole`, `listKioskDevices` (Task 4).
- Produces: nav entries and an admin page to create/delete kiosk devices (showing a new token once).

- [ ] **Step 1: Extend `src/components/SiteNav.tsx`**

Add, in the always-visible group, `<Link href="/kiosk">Kiosk</Link>` and `<Link href="/leaderboard">Leaderboard</Link>`; and inside the existing `hasRole(viewer.role,"admin")` block add `<Link href="/admin/periods">Admin: Periods</Link>`, `<Link href="/admin/kiosk-devices">Admin: Kiosk</Link>`. Add a separate `hasRole(viewer.role,"mentor")` block (mentors + admins) with `<Link href="/admin/sessions/flagged">Flagged sessions</Link>`. Keep everything else intact.

```tsx
// after the always-visible links:
<Link href="/kiosk">Kiosk</Link> <Link href="/leaderboard">Leaderboard</Link>{" "}
{hasRole(viewer.role, "mentor") && (
  <Link href="/admin/sessions/flagged">Flagged sessions</Link>
)}{" "}
{hasRole(viewer.role, "admin") && (
  <>
    {/* existing admin links … */}
    <Link href="/admin/periods">Admin: Periods</Link>{" "}
    <Link href="/admin/kiosk-devices">Admin: Kiosk</Link>{" "}
  </>
)}
```

- [ ] **Step 2: Kiosk device manager component**

Create `src/components/KioskDeviceManager.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function KioskDeviceManager({
  devices,
}: {
  devices: { id: string; name: string; lastSeenAt: string | null }[];
}) {
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    setStatus(null); setNewToken(null);
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
  }
  async function remove(id: string) {
    if (!confirm("Delete this kiosk device? Tablets using it will stop working.")) return;
    const res = await fetch(`/api/admin/kiosk-devices/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else setStatus("Delete failed.");
  }

  return (
    <div>
      <label>New device name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button disabled={!name.trim()} onClick={create}>Create</button>
      {newToken && (
        <p role="status">
          Token (shown once — enter it on the tablet at <code>/kiosk/setup</code>):{" "}
          <code>{newToken}</code>
        </p>
      )}
      {status && <p role="alert">{status}</p>}
      <ul>
        {devices.map((d) => (
          <li key={d.id}>
            {d.name} — last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}{" "}
            <button onClick={() => remove(d.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Kiosk devices admin page**

Create `src/app/admin/kiosk-devices/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listKioskDevices } from "@/lib/kiosk";
import { KioskDeviceManager } from "@/components/KioskDeviceManager";

export default async function AdminKioskDevicesPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/login");
  const devices = await listKioskDevices();
  return (
    <main>
      <h1>Admin — Kiosk devices</h1>
      <p>Create a token, then enter it once on the shop tablet at <code>/kiosk/setup</code>.</p>
      <KioskDeviceManager devices={devices} />
    </main>
  );
}
```

- [ ] **Step 4: README**

Update the "What's built so far" list: kiosk sign-in/out, who's-here, leaderboard, per-member hours, periods, flagged-session review, nightly auto-close sweep.

- [ ] **Step 5: Full verification + CI**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
./dev bash -lc "curl -s http://localhost:3000/ | grep -oE 'Kiosk|Leaderboard' | sort -u"   # both for a guest
./dev bash -lc "curl -s http://localhost:3000/ | grep -c 'Admin:'"                          # 0 for a guest
```

After pushing, confirm CI: on the HOST run `gh run watch --exit-status`.

```bash
git add -A && git commit -m "feat: add attendance navigation and kiosk-device admin page" && git push
```

---

## Self-review notes

- **Spec coverage (M3 slice):** periods/seasons ✓ (T1, T3); sessions + one-open-session invariant ✓ (T1 index, T4 clockIn); kiosk page + device tokens (name-tap, registered-tablet trust) ✓ (T4, T5); who's-here poll ✓ (T6); hours totals + leaderboard + per-member detail ✓ (T6); flagged-sessions screen + manual edits ✓ (T7); nightly pg_cron sweep, timezone-aware ✓ (T8). Timezone policy (store UTC, convert via `team_timezone`) is honored in the only place day-boundaries matter this milestone — the sweep (T8).
- **Deliberately out of M3 (→ M4):** Google Calendar meeting sync, build days (required/optional), excusals, the attendance calendar grid, `/me/attendance`, `/admin/settings` UI, Playwright suite, deploy. Session *edit* history beyond `edited_by`/`edited_at` stays out (no versioning).
- **M2 carry-forwards folded in:** timezone-aware day boundary (T8 sweep); kiosk endpoints use the M2 rate limiter. (The `clientIp`-trust and admin-redirect-target carry-forwards remain M4/deploy items — not re-touched here.)
- **Verification posture:** the kiosk clock flow (T5) and the sweep function (T8) get **real end-to-end runs** (device-token round-trip; SQL sweep against a backdated session) since neither needs a user session. Admin/mentor page mutations verify via 403-for-anonymous + unit tests, consistent with M1/M2 — but note that once the OAuth fix is confirmed, a real admin session can exercise the periods/flagged/kiosk-device admin UIs too.
- **Type/interface consistency:** `Session`/`sessionFromRow` (T1) consumed by hours (T2), sessions (T4), reports (T6/T7), session-edit (T7); `getActivePeriod` (T3) used by clockIn (T4), home/leaderboard/profile (T6), manual-add (T7); `ClockResult.reason` strings (`no_active_period`, `already_in`, `not_in`) surfaced by the kiosk routes (T5) and rendered by `KioskBoard`; `FlagKind` (T2) assembled by `flaggedSessions` (T7); `verifyKioskToken`/`KIOSK_COOKIE` (T4) used by every kiosk route (T5). The `source` check constraint stays `kiosk|manual|admin`; the sweep marks auto-close via `edited_at` + null `edited_by`, and `sessionFlags` reads exactly that.
