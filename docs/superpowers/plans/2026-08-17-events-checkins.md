# Events with check-ins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Tracks GitHub issue [#23](https://github.com/RAR1741/hub/issues/23) (narrowed v1 scope — see the scope-decision comment on that issue).

**Goal:** Let mentors create events tied to a `period`, let anyone (student or mentor) sign up for an event, and let a mentor run the roster at/after the event — checking in signed-up people (or manually adding someone who wasn't signed up) — which credits the event's full duration as a `session` row.

**Architecture:** Same seams as every prior milestone (see `docs/superpowers/plans/2026-08-1*-m*.md`). Two new tables: `event` (tied to a `period`) and `event_signup` (person↔event, self-service). Check-in does **not** get its own attendance table — it inserts directly into the existing `session` table with `source='event'` and a new nullable `event_id` FK, so hours math / leaderboard / reports need zero changes. Pure validators + DB logic live in `src/lib/`, tested with Vitest using the repo's hand-rolled fake-client injection style (see `src/lib/periods.test.ts`). Mutations go through Next.js Route Handlers gated by `withRole`; the self-service signup route is gated by "any signed-in viewer, self-scoped" like `POST /api/excusal-requests`.

**Tech Stack:** As-built (Next.js App Router, Supabase/Postgres, `@supabase/supabase-js`, Vitest, TypeScript strict, Tailwind design-system classes).

## Global Constraints

- Everything runs in the dev container via `./dev`. **Git runs on the HOST** — commit from the host shell, not inside the container. Push to origin immediately after every commit (project convention).
- All timestamps `timestamptz`, stored UTC; UUID PKs via `gen_random_uuid()`.
- **RLS enabled on every new table with ZERO policies** — service-role-only, matching every existing table (`period`, `session`, `excusal_request`, ...).
- Roles: `admin` > `mentor` > `student` > `guest` (app-level virtual). Event **create/update/delete/check-in are `withRole("mentor")`**. Sign-up/cancel-signup are any signed-in viewer, self-scoped (`person_id` forced from `viewer.person.id`, never from the request body) — matches `POST /api/excusal-requests`.
- No event *types*, no custom per-event-type fields, no drag-and-drop arrange board, no printable roster, no per-attendee partial-credit override, no varsity-letter-points tally — all explicitly out of scope for this plan (split into separate GitHub issues per the #23 scope decision).
- Reuse `session` for attendance — do **not** create a separate event-attendance table. `session.source` gets a new allowed value `'event'`; `session.event_id` is nullable and only set when `source='event'`.
- Default hours credit = the event's full `starts_at`→`ends_at` duration for every checked-in person, no exceptions in this plan.
- `[id]` routes: `type Ctx = { params: Promise<{ id: string }> }` + `await context.params`.
- Reuse existing helpers — do not reimplement: `getDb` (`src/lib/db.ts`), `withRole`/`getViewer` (`src/lib/api.ts`, `src/lib/viewer.ts`), `hasRole` (`src/lib/authz.ts`), `reqString`/`optString` (`src/lib/validate.ts`), `displayName` (`src/lib/people.ts`), `listPeople` (`src/lib/people.ts`), `getPeriod`/`getActivePeriod` (`src/lib/periods.ts`).
- Match the design system: component classes `.card`/`.btn`/`.btn-primary`/`.btn-secondary`/`.table`/`.tablewrap`/`.mono`/`.page-head`/`.sub`, the `<Card>` component and `<Section>` wrapper on `/admin`. Plain semantic HTML, no new UI kit.
- All Vitest unit tests must stay green; add tests for every new pure/DB-logic function using the fake-client-injection style already used throughout `src/lib/*.test.ts` (see `src/lib/periods.test.ts`, `src/lib/excusal-requests.ts`'s callers).
- **New migrations must also be applied to the hosted prod DB** (via `supabase db push` or the Supabase MCP `apply_migration`) — flag it in the task report; the controller applies it.

---

### Task 1: Schema — `event`, `event_signup`, extend `session`

**Files:**
- Create: `supabase/migrations/<timestamp>_events.sql` (via `./dev npx supabase migration new events`)

**Interfaces:**
- Produces: tables `event`, `event_signup`; `session.event_id` column; `session_source_check` now allows `'event'`.

- [ ] **Step 1: Generate the migration file**

Run: `./dev npx supabase migration new events`

- [ ] **Step 2: Write the migration**

```sql
-- Events: mentor-created gatherings tied to a period, with self-service
-- sign-up and a mentor-run check-in roster. Check-ins land in `session`
-- (source='event') so they reuse existing hours/leaderboard/reports math
-- with zero changes elsewhere. See issue #23 (narrowed v1 scope).

create table event (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references period (id) on delete restrict,
  name text not null,
  location text,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid not null references person (id),
  created_at timestamptz not null default now(),
  constraint event_ends_after_starts check (ends_at > starts_at)
);

create index event_period_idx on event (period_id, starts_at);
create index event_starts_at_idx on event (starts_at);

alter table event enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

create table event_signup (
  event_id uuid not null references event (id) on delete cascade,
  person_id uuid not null references person (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, person_id)
);

alter table event_signup enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

-- Event check-ins are ordinary sessions with a new source + a link back to
-- the event. `event_id` is restrict-on-delete (like `session.period_id`) so
-- deleting an event can't silently orphan attendance history; deleteEvent()
-- checks for existing check-ins first and returns a clean 409 instead.
alter table session drop constraint session_source_check;
alter table session add constraint session_source_check
  check (source in ('kiosk', 'manual', 'admin', 'import', 'event'));

alter table session add column event_id uuid references event (id) on delete restrict;

create unique index one_session_per_person_per_event
  on session (person_id, event_id)
  where event_id is not null;

create index session_event_idx on session (event_id) where event_id is not null;
```

- [ ] **Step 3: Validate the migration in isolation**

Run: `./dev bash -lc "psql postgresql://postgres:postgres@host.docker.internal:54322/postgres -v ON_ERROR_STOP=1 -c 'BEGIN;' -f supabase/migrations/<timestamp>_events.sql -c 'ROLLBACK;'"`
Expected: no errors.

- [ ] **Step 4: Apply locally and reset**

Run: `./dev npx supabase migration up` then `./dev npm run db:reset`
Expected: both succeed with no errors; `db:reset` re-seeds successfully (proves the new migration is compatible with existing seed data).

- [ ] **Step 5: Spot-check the schema**

Run: `./dev bash -lc "psql postgresql://postgres:postgres@host.docker.internal:54322/postgres -c \"\\d event\" -c \"\\d event_signup\" -c \"\\d session\""`
Expected: `event`/`event_signup` exist with the columns above; `session` has a new nullable `event_id`; `session_source_check` includes `'event'`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations
git commit -m "feat: event + event_signup schema, session.event_id"
```

**Report: this migration must be applied to prod** (`supabase db push` or Supabase MCP `apply_migration`).

---

### Task 2: Types — `Event`, `EventSignup`, extend `Session`

**Files:**
- Modify: `src/lib/types.ts` (append; extend `SessionSource`/`SessionRow`/`Session`/`sessionFromRow`)
- Modify: `src/lib/types.test.ts` (append tests for the new mappers — if this file doesn't exist yet, create it following the pattern of `src/lib/periods.test.ts`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export type SessionSource = "kiosk" | "manual" | "admin" | "import" | "event";
  export type EventRow = {
    id: string; period_id: string; name: string; location: string | null;
    description: string | null; starts_at: string; ends_at: string;
    created_by: string; created_at: string;
  };
  export type Event = {
    id: string; periodId: string; name: string; location: string | null;
    description: string | null; startsAt: string; endsAt: string;
    createdBy: string; createdAt: string;
  };
  export function eventFromRow(row: EventRow): Event;
  ```
  Also: `SessionRow` gains `event_id: string | null`; `Session` gains `eventId: string | null`; `sessionFromRow` maps it.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/types.test.ts` (create the file with this header if new):

```ts
import { describe, expect, test } from "vitest";
import { eventFromRow, sessionFromRow } from "./types";

describe("eventFromRow", () => {
  test("maps snake_case columns to camelCase", () => {
    expect(
      eventFromRow({
        id: "e1",
        period_id: "p1",
        name: "Robot Demo",
        location: "Library",
        description: null,
        starts_at: "2027-03-01T18:00:00Z",
        ends_at: "2027-03-01T20:00:00Z",
        created_by: "m1",
        created_at: "2027-01-01T00:00:00Z",
      }),
    ).toEqual({
      id: "e1",
      periodId: "p1",
      name: "Robot Demo",
      location: "Library",
      description: null,
      startsAt: "2027-03-01T18:00:00Z",
      endsAt: "2027-03-01T20:00:00Z",
      createdBy: "m1",
      createdAt: "2027-01-01T00:00:00Z",
    });
  });
});

describe("sessionFromRow", () => {
  test("maps event_id through", () => {
    const row = {
      id: "s1", person_id: "p1", period_id: "pd1",
      time_in: "2027-03-01T18:00:00Z", time_out: "2027-03-01T20:00:00Z",
      source: "event" as const, note: null, excluded_from_totals: false,
      edited_by: "m1", edited_at: "2027-01-01T00:00:00Z",
      flags_resolved_at: null, event_id: "e1",
    };
    expect(sessionFromRow(row)).toEqual({
      id: "s1", personId: "p1", periodId: "pd1",
      timeIn: "2027-03-01T18:00:00Z", timeOut: "2027-03-01T20:00:00Z",
      source: "event", note: null, excludedFromTotals: false,
      editedBy: "m1", editedAt: "2027-01-01T00:00:00Z",
      flagsResolvedAt: null, eventId: "e1",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npx vitest run src/lib/types.test.ts`
Expected: FAIL — `eventFromRow` is not exported / `eventId` missing from result.

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, change:

```ts
export type SessionSource = "kiosk" | "manual" | "admin" | "import";
```
to:
```ts
export type SessionSource = "kiosk" | "manual" | "admin" | "import" | "event";
```

Add `event_id: string | null;` to `SessionRow`, `eventId: string | null;` to `Session`, and `eventId: row.event_id,` inside `sessionFromRow`'s return object (alongside the existing `flagsResolvedAt: row.flags_resolved_at,` line).

Append after the `Session`/`sessionFromRow` block:

```ts
export type EventRow = {
  id: string;
  period_id: string;
  name: string;
  location: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string;
  created_by: string;
  created_at: string;
};

export type Event = {
  id: string;
  periodId: string;
  name: string;
  location: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  createdAt: string;
};

export function eventFromRow(row: EventRow): Event {
  return {
    id: row.id,
    periodId: row.period_id,
    name: row.name,
    location: row.location,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./dev npx vitest run src/lib/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the whole repo** (the `SessionSource`/`SessionRow` change touches every existing caller)

Run: `./dev npm run typecheck`
Expected: PASS with no new errors. If any existing `session`-related code does an exhaustive switch/union check on `SessionSource`, add an `"event"` branch there too before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/types.test.ts
git commit -m "feat: Event type + session.eventId, SessionSource 'event'"
```

---

### Task 3: `src/lib/events.ts` — event CRUD (TDD)

**Files:**
- Create: `src/lib/events.ts`
- Create: `src/lib/events.test.ts`

**Interfaces:**
- Consumes: `Event`, `EventRow`, `eventFromRow` (Task 2); `reqString`/`optString` (`src/lib/validate.ts`).
- Produces:
  ```ts
  export type EventInput = {
    name: string; periodId: string; location: string | null;
    description: string | null; startsAt: string; endsAt: string;
  };
  export function parseEventInput(body: unknown): EventInput | null;
  export async function createEvent(input: EventInput, creatorId: string, db?: SupabaseClient):
    Promise<{ ok: true; id: string } | { ok: false; status: number }>;
  export async function listEvents(db?: SupabaseClient): Promise<Event[]>; // all, newest-first
  export async function listUpcomingEvents(db?: SupabaseClient): Promise<Event[]>; // ends_at >= now, soonest-first
  export async function getEvent(id: string, db?: SupabaseClient): Promise<Event | null>;
  export async function updateEvent(id: string, input: EventInput, db?: SupabaseClient):
    Promise<{ ok: boolean; status: number }>;
  export async function deleteEvent(id: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/events.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { deleteEvent, parseEventInput } from "./events";

describe("parseEventInput", () => {
  const base = {
    name: "Robot Demo",
    periodId: "pd1",
    startsAt: "2027-03-01T18:00:00Z",
    endsAt: "2027-03-01T20:00:00Z",
  };

  test("accepts a valid event with no location/description", () => {
    expect(parseEventInput(base)).toEqual({
      ...base,
      location: null,
      description: null,
    });
  });

  test("accepts and trims optional location/description", () => {
    expect(parseEventInput({ ...base, location: " Library ", description: " Bring robot " })).toEqual({
      ...base,
      location: "Library",
      description: "Bring robot",
    });
  });

  test.each([
    [{ ...base, name: "" }],
    [{ ...base, periodId: "" }],
    [{ ...base, startsAt: "not-a-date" }],
    [{ ...base, endsAt: "not-a-date" }],
    [{ ...base, endsAt: base.startsAt }], // ends must be strictly after starts
    [{ ...base, endsAt: "2027-03-01T17:00:00Z" }], // ends before starts
    [null],
  ])("rejects %j", (body) => {
    expect(parseEventInput(body)).toBeNull();
  });

  test("rejects a name longer than 120 chars", () => {
    expect(parseEventInput({ ...base, name: "x".repeat(121) })).toBeNull();
  });
});

describe("deleteEvent", () => {
  function fakeDb(opts: { eventExists: boolean; sessionCount: number }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.eventExists ? { id: "ev1" } : null,
                  error: null,
                }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "session") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({
                  data: opts.sessionCount > 0 ? [{ id: "s1" }] : [],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("404 when the event is missing", async () => {
    expect(await deleteEvent("ev1", fakeDb({ eventExists: false, sessionCount: 0 })))
      .toEqual({ ok: false, status: 404 });
  });

  test("409 when the event has check-ins (don't silently delete history)", async () => {
    expect(await deleteEvent("ev1", fakeDb({ eventExists: true, sessionCount: 1 })))
      .toEqual({ ok: false, status: 409 });
  });

  test("ok when the event has no check-ins", async () => {
    expect(await deleteEvent("ev1", fakeDb({ eventExists: true, sessionCount: 0 })))
      .toEqual({ ok: true, status: 200 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npx vitest run src/lib/events.test.ts`
Expected: FAIL — `./events` module not found.

- [ ] **Step 3: Implement**

Create `src/lib/events.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Event, EventRow } from "./types";
import { eventFromRow } from "./types";
import { optString, reqString } from "./validate";

export type EventInput = {
  name: string;
  periodId: string;
  location: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
};

/** Validate an event payload. PURE. Null = invalid. */
export function parseEventInput(body: unknown): EventInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 120);
  const periodId = reqString(b.periodId, 64);
  const startsAt =
    typeof b.startsAt === "string" && !Number.isNaN(Date.parse(b.startsAt))
      ? new Date(b.startsAt).toISOString()
      : null;
  const endsAt =
    typeof b.endsAt === "string" && !Number.isNaN(Date.parse(b.endsAt))
      ? new Date(b.endsAt).toISOString()
      : null;
  if (!name || !periodId || !startsAt || !endsAt) return null;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  const location = optString(b.location, 200);
  if (!location) return null;
  const description = optString(b.description, 1000);
  if (!description) return null;
  return { name, periodId, startsAt, endsAt, location: location.value, description: description.value };
}

const FOREIGN_KEY_VIOLATION = "23503";

export async function createEvent(
  input: EventInput,
  creatorId: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("event")
    .insert({
      name: input.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      created_by: creatorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 400 : 500 };
  return { ok: true, id: data.id as string };
}

export async function listEvents(db?: SupabaseClient): Promise<Event[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("event").select("*").order("starts_at", { ascending: false });
  return ((data ?? []) as EventRow[]).map(eventFromRow);
}

/** Events that haven't ended yet, soonest first — the sign-up page's list. */
export async function listUpcomingEvents(db?: SupabaseClient): Promise<Event[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("event")
    .select("*")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  return ((data ?? []) as EventRow[]).map(eventFromRow);
}

export async function getEvent(id: string, db?: SupabaseClient): Promise<Event | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("event").select("*").eq("id", id).maybeSingle();
  return data ? eventFromRow(data as EventRow) : null;
}

export async function updateEvent(
  id: string,
  input: EventInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("event")
    .update({
      name: input.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 400 : 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/**
 * Hard-delete an event. `session.event_id references event on delete
 * restrict`, so an event with check-in history is protected at the DB level
 * too — but a clean 409 beats a raw 23503, so this checks explicitly first.
 * `event_signup` rows cascade-delete automatically.
 */
export async function deleteEvent(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("event").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { data: sessions } = await client.from("session").select("id").eq("event_id", id).limit(1);
  if (sessions && sessions.length > 0) return { ok: false, status: 409 };
  const { error } = await client.from("event").delete().eq("id", id);
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 409 : 500 };
  return { ok: true, status: 200 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./dev npx vitest run src/lib/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/events.ts src/lib/events.test.ts
git commit -m "feat: event CRUD library"
```

---

### Task 4: `src/lib/event-signups.ts` — sign-up + roster + check-in (TDD)

**Files:**
- Create: `src/lib/event-signups.ts`
- Create: `src/lib/event-signups.test.ts`

**Interfaces:**
- Consumes: `getEvent` (Task 3); `displayName` (`src/lib/people.ts`).
- Produces:
  ```ts
  export async function signUpForEvent(eventId: string, personId: string, db?: SupabaseClient):
    Promise<{ ok: boolean; status: number }>;
  export async function cancelEventSignup(eventId: string, personId: string, db?: SupabaseClient):
    Promise<{ ok: boolean; status: number }>;
  export type RosterEntry = {
    personId: string; name: string; role: string;
    signedUp: boolean; checkedIn: boolean; sessionId: string | null;
  };
  export async function listEventRoster(eventId: string, db?: SupabaseClient): Promise<RosterEntry[]>;
  export async function checkInPerson(eventId: string, personId: string, mentorId: string, db?: SupabaseClient):
    Promise<{ ok: boolean; status: number }>;
  export async function uncheckIn(sessionId: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/event-signups.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { checkInPerson, listEventRoster, signUpForEvent } from "./event-signups";

describe("signUpForEvent", () => {
  function fakeDb(opts: { conflict?: boolean; fkViolation?: boolean }) {
    return {
      from(table: string) {
        if (table !== "event_signup") throw new Error(`unexpected table ${table}`);
        return {
          insert: async () => ({
            error: opts.conflict
              ? { code: "23505" }
              : opts.fkViolation
                ? { code: "23503" }
                : null,
          }),
        };
      },
    } as never;
  }

  test("201 on a fresh sign-up", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({}))).toEqual({ ok: true, status: 201 });
  });

  test("409 when already signed up", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({ conflict: true })))
      .toEqual({ ok: false, status: 409 });
  });

  test("400 on a bad event/person id", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({ fkViolation: true })))
      .toEqual({ ok: false, status: 400 });
  });
});

describe("checkInPerson", () => {
  function fakeDb(opts: { eventExists: boolean; conflict?: boolean }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.eventExists
                    ? {
                        id: "e1", period_id: "pd1", name: "Demo", location: null,
                        description: null, starts_at: "2027-03-01T18:00:00Z",
                        ends_at: "2027-03-01T20:00:00Z", created_by: "m1",
                        created_at: "2027-01-01T00:00:00Z",
                      }
                    : null,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "session") {
          return {
            insert: async () => ({ error: opts.conflict ? { code: "23505" } : null }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("404 when the event doesn't exist", async () => {
    expect(await checkInPerson("e1", "p1", "m1", fakeDb({ eventExists: false })))
      .toEqual({ ok: false, status: 404 });
  });

  test("201 on a fresh check-in", async () => {
    expect(await checkInPerson("e1", "p1", "m1", fakeDb({ eventExists: true })))
      .toEqual({ ok: true, status: 201 });
  });

  test("409 when already checked in to this event", async () => {
    expect(await checkInPerson("e1", "p1", "m1", fakeDb({ eventExists: true, conflict: true })))
      .toEqual({ ok: false, status: 409 });
  });
});

describe("listEventRoster", () => {
  function fakeDb() {
    return {
      from(table: string) {
        if (table === "event_signup") {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  { person_id: "p1", person: { id: "p1", first_name: "Ann", last_name: "A", display_name: null, role: "student" } },
                  { person_id: "p2", person: { id: "p2", first_name: "Bo", last_name: "B", display_name: null, role: "mentor" } },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "session") {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  // p1 signed up AND checked in; p3 checked in without signing up (manual add)
                  { id: "s1", person_id: "p1", person: { id: "p1", first_name: "Ann", last_name: "A", display_name: null, role: "student" } },
                  { id: "s2", person_id: "p3", person: { id: "p3", first_name: "Cy", last_name: "C", display_name: null, role: "student" } },
                ],
                error: null,
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("merges signups and check-ins, sorted by name", async () => {
    expect(await listEventRoster("e1", fakeDb())).toEqual([
      { personId: "p1", name: "Ann A", role: "student", signedUp: true, checkedIn: true, sessionId: "s1" },
      { personId: "p2", name: "Bo B", role: "mentor", signedUp: true, checkedIn: false, sessionId: null },
      { personId: "p3", name: "Cy C", role: "student", signedUp: false, checkedIn: true, sessionId: "s2" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npx vitest run src/lib/event-signups.test.ts`
Expected: FAIL — `./event-signups` module not found.

- [ ] **Step 3: Implement**

Create `src/lib/event-signups.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "./people";
import { getEvent } from "./events";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

export async function signUpForEvent(
  eventId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("event_signup").insert({ event_id: eventId, person_id: personId });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, status: 409 };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 400 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 201 };
}

export async function cancelEventSignup(
  eventId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("event_signup")
    .delete()
    .eq("event_id", eventId)
    .eq("person_id", personId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

type PersonLite = { id: string; first_name: string; last_name: string; display_name: string | null; role: string };

export type RosterEntry = {
  personId: string;
  name: string;
  role: string;
  signedUp: boolean;
  checkedIn: boolean;
  sessionId: string | null;
};

/**
 * An event's roster: everyone who signed up, plus anyone checked in who
 * didn't (a mentor's manual add). `session` has two person FKs (person_id +
 * edited_by), so its embed uses the `person!person_id` hint to avoid
 * PostgREST's PGRST201 ambiguous-embed error; `event_signup` has only one
 * person FK so no hint is needed there.
 */
export async function listEventRoster(eventId: string, db?: SupabaseClient): Promise<RosterEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const [{ data: signups, error: signupError }, { data: sessions, error: sessionError }] = await Promise.all([
    client.from("event_signup").select("person_id, person(id, first_name, last_name, display_name, role)").eq("event_id", eventId),
    client.from("session").select("id, person_id, person!person_id(id, first_name, last_name, display_name, role)").eq("event_id", eventId),
  ]);
  if (signupError) console.error("listEventRoster: signup query failed", signupError);
  if (sessionError) console.error("listEventRoster: session query failed", sessionError);

  const entries = new Map<string, RosterEntry>();
  for (const s of signups ?? []) {
    if (!s.person) continue;
    const p = s.person as unknown as PersonLite;
    entries.set(p.id, { personId: p.id, name: displayName(p), role: p.role, signedUp: true, checkedIn: false, sessionId: null });
  }
  for (const s of sessions ?? []) {
    if (!s.person) continue;
    const p = s.person as unknown as PersonLite;
    const existing = entries.get(p.id);
    if (existing) {
      existing.checkedIn = true;
      existing.sessionId = s.id as string;
    } else {
      entries.set(p.id, { personId: p.id, name: displayName(p), role: p.role, signedUp: false, checkedIn: true, sessionId: s.id as string });
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check a person into an event: full event-duration credit, `source='event'`,
 * `edited_by`=the mentor running the roster (matches `createManualSession`'s
 * convention for mentor-entered sessions). Works whether or not the person
 * signed up first (manual add). 409 if already checked in to this event
 * (the `one_session_per_person_per_event` partial unique index).
 */
export async function checkInPerson(
  eventId: string,
  personId: string,
  mentorId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const event = await getEvent(eventId, client);
  if (!event) return { ok: false, status: 404 };
  const { error } = await client.from("session").insert({
    person_id: personId,
    period_id: event.periodId,
    event_id: eventId,
    time_in: event.startsAt,
    time_out: event.endsAt,
    source: "event",
    edited_by: mentorId,
    edited_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, status: 409 };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 400 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 201 };
}

/** Undo a mistaken check-in. Scoped to source='event' so it can never delete a kiosk/manual/admin session. */
export async function uncheckIn(sessionId: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("session").delete().eq("id", sessionId).eq("source", "event");
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./dev npx vitest run src/lib/event-signups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-signups.ts src/lib/event-signups.test.ts
git commit -m "feat: event sign-up, roster, and check-in library"
```

---

### Task 5: Admin API routes — event CRUD

**Files:**
- Create: `src/app/api/admin/events/route.ts`
- Create: `src/app/api/admin/events/[id]/route.ts`

**Interfaces:**
- Consumes: `withRole` (`src/lib/api.ts`); `parseEventInput`/`createEvent`/`updateEvent`/`deleteEvent` (Task 3).

- [ ] **Step 1: Create the routes**

`src/app/api/admin/events/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createEvent, parseEventInput } from "@/lib/events";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseEventInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createEvent(input, viewer.person!.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
```

`src/app/api/admin/events/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { deleteEvent, parseEventInput, updateEvent } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("mentor", async (_viewer, request, context) => {
  const { id } = await context.params;
  const input = parseEventInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateEvent(id, input);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteEvent(id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 2: Verify types/lint**

Run: `./dev npm run typecheck && ./dev npm run lint`
Expected: PASS.

- [ ] **Step 3: Restart the dev server and live-check authz**

Run (two separate detached execs, per project convention):
```bash
docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "pkill -9 -f next-server"
```
wait ~4s, then:
```bash
docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "cd /workspaces/hub && npm run dev > /tmp/nextdev.log 2>&1"
```
Poll `http://localhost:3000` until it returns 200, then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/events -H "Content-Type: application/json" -d "{}"
```
Expected: `401` or `403` (no signed-in viewer) — proves the route is actually gated, not just present.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/events
git commit -m "feat: admin event CRUD routes"
```

---

### Task 6: Admin API route — check-in

**Files:**
- Create: `src/app/api/admin/events/[id]/checkin/route.ts`

**Interfaces:**
- Consumes: `withRole`; `checkInPerson`/`uncheckIn` (Task 4).

- [ ] **Step 1: Create the route**

`src/app/api/admin/events/[id]/checkin/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { checkInPerson, uncheckIn } from "@/lib/event-signups";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("mentor", async (viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = body ? reqString(body.personId, 64) : null;
  if (!personId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await checkInPerson(id, personId, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true }, { status: 201 })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, request) => {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await uncheckIn(sessionId);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 2: Verify**

Run: `./dev npm run typecheck && ./dev npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/events
git commit -m "feat: admin event check-in/uncheck route"
```

---

### Task 7: Self-service API route — sign up / cancel

**Files:**
- Create: `src/app/api/events/[id]/signup/route.ts`

**Interfaces:**
- Consumes: `getViewer` (`src/lib/viewer.ts`); `signUpForEvent`/`cancelEventSignup` (Task 4); `createRateLimiter`/`clientIp` (`src/lib/rate-limit.ts`).

- [ ] **Step 1: Create the route**

`src/app/api/events/[id]/signup/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cancelEventSignup, signUpForEvent } from "@/lib/event-signups";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { getViewer } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

const signupLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(request: Request, context: Ctx) {
  if (!signupLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await context.params;
  // person_id is ALWAYS the viewer's own id — never read from the body.
  const result = await signUpForEvent(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}

export async function DELETE(_request: Request, context: Ctx) {
  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await context.params;
  const result = await cancelEventSignup(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}
```

- [ ] **Step 2: Verify + live-check**

Run: `./dev npm run typecheck && ./dev npm run lint`, then after a dev-server restart (Task 5, Step 3):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/events/00000000-0000-0000-0000-000000000000/signup
```
Expected: `401` (no signed-in viewer).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/events
git commit -m "feat: self-service event sign-up/cancel route"
```

---

### Task 8: Admin UI — events list + create form

**Files:**
- Create: `src/app/admin/events/page.tsx`
- Create: `src/components/EventForm.tsx`

**Interfaces:**
- Consumes: `getViewer`/`hasRole`; `listEvents` (Task 3); `listPeriods` (`src/lib/periods.ts`).

- [ ] **Step 1: Build the page**

`src/app/admin/events/page.tsx` (Server Component, mirrors `src/app/admin/periods/page.tsx`):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { listEvents } from "@/lib/events";
import { listPeriods } from "@/lib/periods";
import { getViewer } from "@/lib/viewer";
import { EventForm } from "@/components/EventForm";

export default async function AdminEventsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const [events, periods] = await Promise.all([listEvents(), listPeriods()]);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Events</h1>
          <div className="sub">Outreach, demos, training — sign-up + mentor-run check-in.</div>
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">New event</summary>
        <div className="mt-4">
          <EventForm periods={periods} />
        </div>
      </details>

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Period</th><th>Starts</th><th>Ends</th><th>Location</th><th></th></tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const period = periods.find((p) => p.id === e.periodId);
                return (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td>{period?.name ?? ""}</td>
                    <td className="mono">{new Date(e.startsAt).toLocaleString()}</td>
                    <td className="mono">{new Date(e.endsAt).toLocaleString()}</td>
                    <td>{e.location ?? ""}</td>
                    <td><Link href={`/admin/events/${e.id}`} className="btn btn-secondary px-3 py-1">Roster</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Build the create form**

`src/components/EventForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Period } from "@/lib/types";

export function EventForm({ periods }: { periods: Period[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          periodId,
          location: location || null,
          description: description || null,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      if (res.ok) {
        setName("");
        setLocation("");
        setDescription("");
        setStartsAt("");
        setEndsAt("");
        router.refresh();
      } else {
        setError("Could not create the event — check the dates and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="label">Period
        <select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="label">Location (optional)<input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="label">Description (optional)<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="label">Starts<input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
      <label className="label">Ends<input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></label>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">{busy ? "Saving…" : "Create event"}</button>
    </form>
  );
}
```

- [ ] **Step 3: Manual browser verification**

After a dev-server restart (Task 5, Step 3), sign in as a mentor/admin in the browser, go to `/admin/events`, create an event with a period from the dropdown, and confirm it appears in the table with a working "Roster" link. Take a screenshot if anything looks off.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/events/page.tsx src/components/EventForm.tsx
git commit -m "feat: admin events list + create form"
```

---

### Task 9: Admin UI — event roster page (check-in + manual add)

**Files:**
- Create: `src/app/admin/events/[id]/page.tsx`
- Create: `src/components/EventRosterActions.tsx`

**Interfaces:**
- Consumes: `getEvent` (Task 3); `listEventRoster` (Task 4); `listPeople` (`src/lib/people.ts`).

- [ ] **Step 1: Build the page**

`src/app/admin/events/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { getEvent } from "@/lib/events";
import { listEventRoster } from "@/lib/event-signups";
import { listPeople } from "@/lib/people";
import { displayName } from "@/lib/people";
import { getViewer } from "@/lib/viewer";
import { EventRosterActions, ManualAddPerson } from "@/components/EventRosterActions";

export default async function EventRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  const [roster, allPeople] = await Promise.all([listEventRoster(id), listPeople()]);
  const rosterIds = new Set(roster.map((r) => r.personId));
  const addable = allPeople
    .filter((p) => !rosterIds.has(p.id))
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>{event.name}</h1>
          <div className="sub">
            {new Date(event.startsAt).toLocaleString()} – {new Date(event.endsAt).toLocaleString()}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
      </div>

      <ManualAddPerson eventId={id} people={addable} />

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Signed up</th><th>Checked in</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.personId}>
                  <td>{r.name}</td>
                  <td className="mono">{r.role}</td>
                  <td>{r.signedUp ? "Yes" : ""}</td>
                  <td>{r.checkedIn ? "Yes" : ""}</td>
                  <td><EventRosterActions eventId={id} entry={r} /></td>
                </tr>
              ))}
              {roster.length === 0 && (
                <tr><td colSpan={5} className="text-sm text-[var(--muted)]">No sign-ups yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Build the action components**

`src/components/EventRosterActions.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RosterEntry } from "@/lib/event-signups";

export function EventRosterActions({ eventId, entry }: { eventId: string; entry: RosterEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function checkIn() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: entry.personId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uncheck() {
    if (!entry.sessionId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/checkin?sessionId=${entry.sessionId}`,
        { method: "DELETE" },
      );
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return entry.checkedIn ? (
    <button disabled={busy} onClick={uncheck} className="btn btn-secondary px-3 py-1">
      {busy ? "Working…" : "Undo check-in"}
    </button>
  ) : (
    <button disabled={busy} onClick={checkIn} className="btn btn-primary px-3 py-1">
      {busy ? "Working…" : "Check in"}
    </button>
  );
}

export function ManualAddPerson({
  eventId,
  people,
}: {
  eventId: string;
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!personId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (people.length === 0) return null;

  return (
    <div className="card flex flex-wrap items-center gap-3">
      <span className="font-semibold">Add someone who didn&apos;t sign up:</span>
      <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button disabled={busy} onClick={add} className="btn btn-primary px-3 py-1">
        {busy ? "Working…" : "Add & check in"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Manual browser verification**

After a dev-server restart, from `/admin/events`, open an event's Roster page. Confirm: signed-up people show with "Check in" buttons; clicking "Check in" flips it to "Undo check-in" and the row shows "Checked in: Yes"; the manual-add dropdown lists only people not already on the roster, and adding someone puts them in the table as checked-in with "Signed up: " blank.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/events/[id]/page.tsx src/components/EventRosterActions.tsx
git commit -m "feat: admin event roster page (check-in + manual add)"
```

---

### Task 10: Student/mentor-facing UI — sign up for events

**Files:**
- Create: `src/app/events/page.tsx`
- Create: `src/components/EventSignupButton.tsx`

**Interfaces:**
- Consumes: `getViewer`; `listUpcomingEvents` (Task 3); a lookup of the viewer's own signups.

- [ ] **Step 1: Add a signup lookup helper**

Append to `src/lib/event-signups.ts` (after `cancelEventSignup`):

```ts
/** Event ids the given person has signed up for, among the given event ids. */
export async function signedUpEventIds(
  personId: string,
  eventIds: string[],
  db?: SupabaseClient,
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("event_signup")
    .select("event_id")
    .eq("person_id", personId)
    .in("event_id", eventIds);
  return new Set((data ?? []).map((r) => r.event_id as string));
}
```

Add one test to `src/lib/event-signups.test.ts`:

```ts
describe("signedUpEventIds", () => {
  test("returns only the ids the person signed up for", async () => {
    const fakeDb = {
      from(table: string) {
        if (table !== "event_signup") throw new Error(`unexpected table ${table}`);
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [{ event_id: "e1" }] }) }) }) };
      },
    } as never;
    expect(await signedUpEventIds("p1", ["e1", "e2"], fakeDb)).toEqual(new Set(["e1"]));
  });
});
```

Run: `./dev npx vitest run src/lib/event-signups.test.ts` — expect PASS after adding the import of `signedUpEventIds` at the top of the test file.

- [ ] **Step 2: Build the page**

`src/app/events/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { listUpcomingEvents } from "@/lib/events";
import { signedUpEventIds } from "@/lib/event-signups";
import { getViewer } from "@/lib/viewer";
import { EventSignupButton } from "@/components/EventSignupButton";

export default async function EventsPage() {
  const viewer = await getViewer();
  if (!viewer.person) redirect("/login");

  const events = await listUpcomingEvents();
  const signedUp = await signedUpEventIds(viewer.person.id, events.map((e) => e.id));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Events</h1>
          <div className="sub">Sign up for upcoming outreach, demos, and training.</div>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">No upcoming events.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((e) => (
            <div key={e.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{e.name}</div>
                <div className="sub mono">
                  {new Date(e.startsAt).toLocaleString()} – {new Date(e.endsAt).toLocaleString()}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
                {e.description && <div className="text-sm text-[var(--muted)]">{e.description}</div>}
              </div>
              <EventSignupButton eventId={e.id} initiallySignedUp={signedUp.has(e.id)} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Build the signup button**

`src/components/EventSignupButton.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EventSignupButton({
  eventId,
  initiallySignedUp,
}: {
  eventId: string;
  initiallySignedUp: boolean;
}) {
  const router = useRouter();
  const [signedUp, setSignedUp] = useState(initiallySignedUp);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/signup`, {
        method: signedUp ? "DELETE" : "POST",
      });
      if (res.ok) {
        setSignedUp(!signedUp);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      disabled={busy}
      onClick={toggle}
      className={signedUp ? "btn btn-secondary px-3 py-1" : "btn btn-primary px-3 py-1"}
    >
      {busy ? "Working…" : signedUp ? "Cancel sign-up" : "Sign up"}
    </button>
  );
}
```

- [ ] **Step 4: Manual browser verification**

After a dev-server restart, sign in as a student and as a mentor (separately) and confirm `/events` lists upcoming events for both, "Sign up" toggles to "Cancel sign-up" and persists across a refresh, and the event created in Task 8 shows up here once its `endsAt` is in the future.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-signups.ts src/lib/event-signups.test.ts src/app/events/page.tsx src/components/EventSignupButton.tsx
git commit -m "feat: student/mentor event sign-up page"
```

---

### Task 11: Nav + admin dashboard wiring

**Files:**
- Modify: `src/components/SiteNav.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `hasRole` (already imported in both files); `listEvents` (Task 3).

- [ ] **Step 1: Add the top nav link**

In `src/components/SiteNav.tsx`, add a link visible to any signed-in person (students, mentors, admins — matches who can sign up), placed next to the existing `Teams` link:

```tsx
{hasRole(viewer.role, "student") && (
  <Link href="/events" className={navLinkClass}>
    Events
  </Link>
)}{" "}
```

- [ ] **Step 2: Add the admin dashboard card**

In `src/app/admin/page.tsx`, import `listEvents` from `@/lib/events`, fetch it alongside the other dashboard data (add to the existing `Promise.all` batch or fetch separately — match whatever pattern is already there), and add a card in the "Time" section next to Meetings/Build days/Sessions:

```tsx
<Card href="/admin/events" icon="calendar" title="Events" count={events.length} hint="Outreach, demos, training — sign-up + check-in." />
```

- [ ] **Step 3: Manual browser verification**

After a dev-server restart, confirm the "Events" link appears in the top nav for a student and a mentor, and the "Events" card appears on `/admin` with the correct count.

- [ ] **Step 4: Commit**

```bash
git add src/components/SiteNav.tsx src/app/admin/page.tsx
git commit -m "feat: wire Events into nav + admin dashboard"
```

---

### Task 12: Full verification pass

- [ ] **Step 1: Full unit suite**

Run: `./dev npm run test`
Expected: all green, including every new `*.test.ts` from Tasks 2–4 and 10.

- [ ] **Step 2: Typecheck + lint + build**

Run: `./dev npm run typecheck && ./dev npm run lint && ./dev npm run build`
Expected: all pass.

- [ ] **Step 3: End-to-end manual walkthrough in the browser**

After a dev-server restart: as a mentor, create an event on an existing period at `/admin/events`; as a student, sign up for it at `/events`; as the mentor, open the event's roster at `/admin/events/[id]`, check the student in, and confirm a manual add for a second person who didn't sign up also works; confirm both people's hours show up wherever `session` rows normally surface (e.g. `/admin/sessions`, the leaderboard) with `source='event'`.

- [ ] **Step 4: Push**

```bash
git push origin master
```

## Self-review notes

- **Spec coverage (issue #23, narrowed scope):** events tied to a period (Task 1, 3); no event types/custom fields (honored — schema has no such columns); mentor-run roster check-in with manual add (Task 9); sign-up drives the default roster, both students and mentors can sign up (Task 4, 7, 10 — `event_signup` has no role restriction); full-duration default credit, no per-attendee override (Task 4's `checkInPerson` always uses `event.startsAt`/`endsAt`); check-ins reuse `session` (Task 1, 4) so hours/leaderboard/reports need no changes; no arrange board, no printable roster, no varsity-letter tally — all absent by design, tracked in the four spun-off issues.
- **Safety:** self-service signup/cancel routes force `person_id` from `viewer.person.id` (Task 7), never the body — matches the excusal-request precedent. All mutation routes but signup/cancel are `withRole("mentor")`. `uncheckIn` is scoped to `source='event'` so it can't delete a kiosk/manual/admin session by id collision.
- **Deferred (out of scope, tracked in separate issues):** varsity-letter-points tally; per-attendee partial/override credit; drag-and-drop arrange board; printable rosters.
