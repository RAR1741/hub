# Google Calendar Event Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin optionally link an `event` row to a Google Calendar event (via the id already synced into `meeting`), auto-filling name/date/time from it, and keep that link in sync — updating the event when the calendar changes, flagging it for review if the calendar event disappears.

**Architecture:** One additive migration (`event.gcal_event_id`, `event.gcal_missing`). `src/lib/events.ts` gains a candidate-listing query and resolves name/starts_at/ends_at from the linked `meeting` row on create/update (server is the source of truth, not client-submitted text). `src/lib/gcal.ts`'s existing `syncCalendar()` gains one more step, run after its `meeting` upsert, that reconciles linked `event` rows against the now-fresh `meeting` table via a pure diff function. UI: `EventForm` gets an optional calendar-event picker; the event roster page gets a "link missing" banner with an unlink action.

**Tech Stack:** Next.js App Router, Supabase (Postgres + supabase-js), vitest, no new dependencies.

## Global Constraints

- No new npm dependency — reuse the existing hand-rolled REST/JWT Google auth and the already-synced `meeting` table (spec: "Out of scope").
- Calendar always wins for `name`/`starts_at`/`ends_at` on a linked event; `location`/`description` are never derived from or overwritten by the calendar link (spec: "Suggesting candidates", "Keeping it in sync").
- No new cron/endpoint for the event-link sync — piggyback on the existing `syncCalendar()` call path (spec: "Keeping it in sync").
- A linked event whose calendar event disappears is flagged (`gcal_missing = true`), never auto-unlinked or deleted (spec: "Keeping it in sync", "Admin UI").
- Migration file naming: `YYYYMMDDHHMMSS_description.sql`, additive only, matching the style in `supabase/migrations/20260817182818_events.sql` (small, comment-documented, `alter table` not rewrites).

---

### Task 1: Migration — link columns on `event`

**Files:**
- Create: `supabase/migrations/20260817190000_event_gcal_link.sql`

**Interfaces:**
- Produces: `event.gcal_event_id text` (nullable), `event.gcal_missing boolean not null default false`, unique partial index `event_gcal_event_id_idx`.

- [ ] **Step 1: Write the migration**

```sql
-- Optional link from a one-off `event` row to the Google Calendar event it
-- mirrors. `gcal_event_id` matches `meeting.gcal_event_id` (already populated
-- by the existing calendar sync) rather than duplicating a live Google API
-- call. Once linked, syncCalendar() keeps name/starts_at/ends_at in lock-step
-- with the calendar; gcal_missing flags a link whose calendar event
-- disappeared upstream, for admin review — it never auto-unlinks or deletes.
alter table event add column gcal_event_id text;
alter table event add column gcal_missing boolean not null default false;

-- One event per calendar event. Postgres treats NULLs as distinct, so any
-- number of unlinked (gcal_event_id null) events coexist untouched.
create unique index event_gcal_event_id_idx on event (gcal_event_id) where gcal_event_id is not null;
```

- [ ] **Step 2: Apply locally and confirm it runs cleanly**

Run: `supabase db reset` (or the project's usual local-migration-apply command)
Expected: migration applies with no errors, `event` table now has the two new columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260817190000_event_gcal_link.sql
git commit -m "feat: add gcal_event_id/gcal_missing link columns to event"
```

---

### Task 2: `Event` type gains the link fields

**Files:**
- Modify: `src/lib/types.ts:192-228`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EventRow.gcal_event_id: string | null`, `EventRow.gcal_missing: boolean`, `Event.gcalEventId: string | null`, `Event.gcalMissing: boolean`, updated `eventFromRow`.

- [ ] **Step 1: Update the row/domain types and mapper**

Replace lines 192–228 of `src/lib/types.ts`:

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
  gcal_event_id: string | null;
  gcal_missing: boolean;
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
  gcalEventId: string | null;
  gcalMissing: boolean;
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
    gcalEventId: row.gcal_event_id,
    gcalMissing: row.gcal_missing,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: fails right now (nothing constructs `EventRow`/`Event` object literals in this task, so this should actually still pass — if it fails, it's telling you another file builds an `EventRow` literal that needs the two new fields; fix that call site before continuing).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add gcal link fields to Event/EventRow types"
```

---

### Task 3: `events.ts` — resolve linked fields from `meeting`, list candidates, unlink

**Files:**
- Modify: `src/lib/events.ts`
- Test: `src/lib/events.test.ts`

**Interfaces:**
- Consumes: `EventRow`/`Event`/`eventFromRow` from Task 2.
- Produces: `EventInput.gcalEventId: string | null`; `lookupMeetingByGcalId(gcalEventId, db?)`; `createEvent`/`updateEvent` now resolve `name`/`starts_at`/`ends_at` from the linked meeting when `gcalEventId` is set, and 400 if the id doesn't match any `meeting`; `listGcalCandidates(db?): Promise<GcalCandidate[]>` where `GcalCandidate = { id: string; title: string; startsAt: string; endsAt: string }`; `unlinkEvent(id, db?): Promise<{ ok: boolean; status: number }>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/events.test.ts` (after the existing `parseEventInput` describe block, before `deleteEvent`):

```ts
describe("parseEventInput — gcalEventId", () => {
  const base = {
    name: "Robot Demo",
    periodId: "11111111-1111-1111-1111-111111111111",
    startsAt: "2027-03-01T18:00:00Z",
    endsAt: "2027-03-01T20:00:00Z",
  };

  test("defaults to null when absent", () => {
    expect(parseEventInput(base)?.gcalEventId).toBeNull();
  });

  test("carries a non-empty string through, trimmed", () => {
    expect(parseEventInput({ ...base, gcalEventId: " evt-42 " })?.gcalEventId).toBe("evt-42");
  });

  test("blank/non-string gcalEventId is treated as absent", () => {
    expect(parseEventInput({ ...base, gcalEventId: "" })?.gcalEventId).toBeNull();
    expect(parseEventInput({ ...base, gcalEventId: 5 })?.gcalEventId).toBeNull();
  });
});

describe("createEvent — linked to a calendar event", () => {
  function fakeDb(opts: { meeting: { title: string; starts_at: string; ends_at: string } | null }) {
    return {
      from(table: string) {
        if (table === "meeting") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.meeting, error: null }),
              }),
            }),
          };
        }
        if (table === "event") {
          return {
            insert: (row: Record<string, unknown>) => ({
              select: () => ({
                single: async () => ({ data: { id: "new-event", _row: row }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  const input = {
    name: "Client-supplied name (should be ignored)",
    periodId: "11111111-1111-1111-1111-111111111111",
    location: null,
    description: null,
    startsAt: "2027-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T01:00:00.000Z",
    gcalEventId: "evt-42",
  };

  test("resolves name/starts_at/ends_at from the matching meeting, ignoring client text", async () => {
    const db = fakeDb({
      meeting: { title: "Scouting Trip", starts_at: "2027-05-01T14:00:00.000Z", ends_at: "2027-05-01T18:00:00.000Z" },
    });
    const result = await createEvent(input, "creator-1", db);
    expect(result).toEqual({ ok: true, id: "new-event" });
  });

  test("400s when gcalEventId doesn't match any meeting", async () => {
    const db = fakeDb({ meeting: null });
    const result = await createEvent(input, "creator-1", db);
    expect(result).toEqual({ ok: false, status: 400 });
  });
});

describe("listGcalCandidates", () => {
  function fakeDb(opts: {
    meetings: { gcal_event_id: string; title: string; starts_at: string; ends_at: string }[];
    claimed: string[];
  }) {
    return {
      from(table: string) {
        if (table === "meeting") {
          return {
            select: () => ({
              gte: () => ({
                order: async () => ({ data: opts.meetings, error: null }),
              }),
            }),
          };
        }
        if (table === "event") {
          return {
            select: () => ({
              not: async () => ({ data: opts.claimed.map((id) => ({ gcal_event_id: id })), error: null }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("excludes meetings already claimed by another event", async () => {
    const db = fakeDb({
      meetings: [
        { gcal_event_id: "evt-1", title: "Scouting Trip", starts_at: "2027-05-01T14:00:00Z", ends_at: "2027-05-01T18:00:00Z" },
        { gcal_event_id: "evt-2", title: "Regular Meeting", starts_at: "2027-05-08T23:00:00Z", ends_at: "2027-05-09T01:00:00Z" },
      ],
      claimed: ["evt-2"],
    });
    const candidates = await listGcalCandidates(db);
    expect(candidates).toEqual([
      { id: "evt-1", title: "Scouting Trip", startsAt: "2027-05-01T14:00:00Z", endsAt: "2027-05-01T18:00:00Z" },
    ]);
  });
});

describe("unlinkEvent", () => {
  function fakeDb(opts: { found: boolean }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            update: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: opts.found ? { id: "ev1" } : null, error: null }),
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
    expect(await unlinkEvent("ev1", fakeDb({ found: false }))).toEqual({ ok: false, status: 404 });
  });

  test("ok when found", async () => {
    expect(await unlinkEvent("ev1", fakeDb({ found: true }))).toEqual({ ok: true, status: 200 });
  });
});
```

Also update the two existing `parseEventInput` assertions (in the first `describe("parseEventInput", ...)` block) to include the new field, since `toEqual` is exact-match:

```ts
  test("accepts a valid event with no location/description", () => {
    expect(parseEventInput(base)).toEqual({
      ...normalized,
      location: null,
      description: null,
      gcalEventId: null,
    });
  });

  test("accepts and trims optional location/description", () => {
    expect(parseEventInput({ ...base, location: " Library ", description: " Bring robot " })).toEqual({
      ...normalized,
      location: "Library",
      description: "Bring robot",
      gcalEventId: null,
    });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/events.test.ts`
Expected: FAIL — `parseEventInput` doesn't set `gcalEventId`; `createEvent`/`listGcalCandidates`/`unlinkEvent` either don't exist or don't match.

- [ ] **Step 3: Implement**

In `src/lib/events.ts`, replace the whole file with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Event, EventRow } from "./types";
import { eventFromRow } from "./types";
import { optString, reqString, reqUuid } from "./validate";

export type EventInput = {
  name: string;
  periodId: string;
  location: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  gcalEventId: string | null;
};

/** Validate an event payload. PURE. Null = invalid. */
export function parseEventInput(body: unknown): EventInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 120);
  const periodId = reqUuid(b.periodId);
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
  const gcalEventId = typeof b.gcalEventId === "string" && b.gcalEventId.trim() ? b.gcalEventId.trim() : null;
  return {
    name,
    periodId,
    startsAt,
    endsAt,
    location: location.value,
    description: description.value,
    gcalEventId,
  };
}

const FOREIGN_KEY_VIOLATION = "23503";

type LinkedMeeting = { title: string; starts_at: string; ends_at: string };

/** The meeting a gcal_event_id points at, or null if it doesn't match one. */
async function lookupMeetingByGcalId(
  gcalEventId: string,
  db: SupabaseClient,
): Promise<LinkedMeeting | null> {
  const { data } = await db
    .from("meeting")
    .select("title, starts_at, ends_at")
    .eq("gcal_event_id", gcalEventId)
    .maybeSingle();
  return (data as LinkedMeeting | null) ?? null;
}

/**
 * When `input.gcalEventId` is set, name/starts_at/ends_at come from the
 * matching `meeting` row — never from client-submitted text — so a linked
 * event can't be created or edited out of step with the calendar. Null =
 * the id didn't match any meeting (caller should 400).
 */
async function resolveLinkedFields(
  input: EventInput,
  db: SupabaseClient,
): Promise<{ name: string; startsAt: string; endsAt: string } | null> {
  if (!input.gcalEventId) return { name: input.name, startsAt: input.startsAt, endsAt: input.endsAt };
  const meeting = await lookupMeetingByGcalId(input.gcalEventId, db);
  if (!meeting) return null;
  return { name: meeting.title, startsAt: meeting.starts_at, endsAt: meeting.ends_at };
}

export async function createEvent(
  input: EventInput,
  creatorId: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const resolved = await resolveLinkedFields(input, client);
  if (!resolved) return { ok: false, status: 400 };
  const { data, error } = await client
    .from("event")
    .insert({
      name: resolved.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: resolved.startsAt,
      ends_at: resolved.endsAt,
      created_by: creatorId,
      gcal_event_id: input.gcalEventId,
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
  const resolved = await resolveLinkedFields(input, client);
  if (!resolved) return { ok: false, status: 400 };
  const { data, error } = await client
    .from("event")
    .update({
      name: resolved.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: resolved.startsAt,
      ends_at: resolved.endsAt,
      gcal_event_id: input.gcalEventId,
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

export type GcalCandidate = { id: string; title: string; startsAt: string; endsAt: string };

type MeetingLite = { gcal_event_id: string; title: string; starts_at: string; ends_at: string };

/**
 * Upcoming synced calendar events not yet linked to any `event` row — the
 * admin event form's "attach to a calendar event" picker. No live Google
 * API call: `meeting` is already kept current by the calendar sync cron.
 */
export async function listGcalCandidates(db?: SupabaseClient): Promise<GcalCandidate[]> {
  const client = db ?? (await import("./db")).getDb();
  const [{ data: meetings }, { data: claimed }] = await Promise.all([
    client
      .from("meeting")
      .select("gcal_event_id, title, starts_at, ends_at")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }),
    client.from("event").select("gcal_event_id").not("gcal_event_id", "is", null),
  ]);
  const claimedIds = new Set(((claimed ?? []) as { gcal_event_id: string }[]).map((c) => c.gcal_event_id));
  return ((meetings ?? []) as MeetingLite[])
    .filter((m) => !claimedIds.has(m.gcal_event_id))
    .map((m) => ({ id: m.gcal_event_id, title: m.title, startsAt: m.starts_at, endsAt: m.ends_at }));
}

/** Clears a calendar link (and any missing-flag) without touching anything else on the event. */
export async function unlinkEvent(id: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("event")
    .update({ gcal_event_id: null, gcal_missing: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/events.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (check `src/app/api/admin/events/route.ts` / `[id]/route.ts` still compile — they don't construct `EventInput` literals themselves, only pass through `parseEventInput`'s result, so no changes needed there)

- [ ] **Step 6: Commit**

```bash
git add src/lib/events.ts src/lib/events.test.ts
git commit -m "feat: resolve linked event fields from meeting, add candidate list + unlink"
```

---

### Task 4: API routes — candidates list + unlink

**Files:**
- Create: `src/app/api/admin/events/gcal-candidates/route.ts`
- Create: `src/app/api/admin/events/[id]/unlink/route.ts`

**Interfaces:**
- Consumes: `listGcalCandidates`, `unlinkEvent` from Task 3; `withRole` from `src/lib/api.ts`; `reqUuid` from `src/lib/validate.ts`.
- Produces: `GET /api/admin/events/gcal-candidates` → `{ candidates: GcalCandidate[] }`; `POST /api/admin/events/:id/unlink` → `{ ok: true }` or `{ error }`.

- [ ] **Step 1: Write the routes**

`src/app/api/admin/events/gcal-candidates/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { listGcalCandidates } from "@/lib/events";

export const GET = withRole("mentor", async () => {
  const candidates = await listGcalCandidates();
  return Response.json({ candidates });
});
```

`src/app/api/admin/events/[id]/unlink/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { unlinkEvent } from "@/lib/events";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await unlinkEvent(id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});
```

- [ ] **Step 2: Typecheck (routes have no dedicated test file — mirrors the existing `route.ts` files, which also aren't unit-tested directly; coverage comes from `events.ts`'s tests plus manual verification in Task 6)**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/events/gcal-candidates/route.ts src/app/api/admin/events/[id]/unlink/route.ts
git commit -m "feat: add gcal-candidates list and unlink endpoints"
```

---

### Task 5: `syncCalendar()` reconciles linked events

**Files:**
- Modify: `src/lib/gcal.ts`
- Test: `src/lib/gcal.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks (works directly against `event`/`meeting` tables).
- Produces: exported pure `diffLinkedEvents(linked, meetingsByGcalId)`; `SyncResult` gains `linkedEventsUpdated: number`; `syncCalendar()` now also reconciles linked events after its `meeting` upsert.

- [ ] **Step 1: Write the failing unit test for the pure diff function**

Add to `src/lib/gcal.test.ts` (new `describe` block, anywhere after the imports):

```ts
describe("diffLinkedEvents", () => {
  test("no matching meeting and not yet flagged → flags gcal_missing", () => {
    const linked = [{ id: "ev1", gcal_event_id: "evt-1", name: "Old Name", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T01:00:00Z", gcal_missing: false }];
    expect(diffLinkedEvents(linked, new Map())).toEqual([{ id: "ev1", gcal_missing: true }]);
  });

  test("no matching meeting but already flagged → no redundant write", () => {
    const linked = [{ id: "ev1", gcal_event_id: "evt-1", name: "Old Name", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T01:00:00Z", gcal_missing: true }];
    expect(diffLinkedEvents(linked, new Map())).toEqual([]);
  });

  test("matching meeting with changed fields → updates name/starts_at/ends_at, clears gcal_missing", () => {
    const linked = [{ id: "ev1", gcal_event_id: "evt-1", name: "Old Name", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T01:00:00Z", gcal_missing: true }];
    const meetings = new Map([["evt-1", { gcal_event_id: "evt-1", title: "New Name", starts_at: "2027-02-01T00:00:00Z", ends_at: "2027-02-01T01:00:00Z" }]]);
    expect(diffLinkedEvents(linked, meetings)).toEqual([
      { id: "ev1", name: "New Name", starts_at: "2027-02-01T00:00:00Z", ends_at: "2027-02-01T01:00:00Z", gcal_missing: false },
    ]);
  });

  test("matching meeting with no changes and not flagged → no write", () => {
    const linked = [{ id: "ev1", gcal_event_id: "evt-1", name: "Same", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T01:00:00Z", gcal_missing: false }];
    const meetings = new Map([["evt-1", { gcal_event_id: "evt-1", title: "Same", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T01:00:00Z" }]]);
    expect(diffLinkedEvents(linked, meetings)).toEqual([]);
  });

  test("matching meeting with no changes but was flagged → clears the flag only", () => {
    const linked = [{ id: "ev1", gcal_event_id: "evt-1", name: "Same", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T01:00:00Z", gcal_missing: true }];
    const meetings = new Map([["evt-1", { gcal_event_id: "evt-1", title: "Same", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-01T01:00:00Z" }]]);
    expect(diffLinkedEvents(linked, meetings)).toEqual([{ id: "ev1", gcal_missing: false }]);
  });
});
```

Add the matching import at the top of `src/lib/gcal.test.ts`:

```ts
import {
  buildServiceAccountJwt,
  diffLinkedEvents,
  isRequiredEvent,
  pickCalendarId,
  syncCalendar,
  type GcalTransport,
} from "./gcal";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/gcal.test.ts`
Expected: FAIL — `diffLinkedEvents` is not exported yet.

- [ ] **Step 3: Implement the pure diff function and types in `gcal.ts`**

Add after `isRequiredEvent` (around line 117) in `src/lib/gcal.ts`:

```ts
export type LinkedEventRow = {
  id: string;
  gcal_event_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  gcal_missing: boolean;
};

export type MeetingLite = { gcal_event_id: string; title: string; starts_at: string; ends_at: string };

export type LinkedEventWrite = {
  id: string;
  name?: string;
  starts_at?: string;
  ends_at?: string;
  gcal_missing: boolean;
};

/**
 * Diff `event` rows linked to a calendar event against the just-synced
 * `meeting` table. PURE. Only returns rows that actually need a DB write —
 * a linked event with nothing changed and no flag to clear produces no
 * write, so a sync run doesn't touch every linked event every time.
 */
export function diffLinkedEvents(
  linkedEvents: LinkedEventRow[],
  meetingsByGcalId: Map<string, MeetingLite>,
): LinkedEventWrite[] {
  const writes: LinkedEventWrite[] = [];
  for (const row of linkedEvents) {
    const meeting = meetingsByGcalId.get(row.gcal_event_id);
    if (!meeting) {
      if (!row.gcal_missing) writes.push({ id: row.id, gcal_missing: true });
      continue;
    }
    const changed =
      meeting.title !== row.name || meeting.starts_at !== row.starts_at || meeting.ends_at !== row.ends_at;
    if (changed) {
      writes.push({
        id: row.id,
        name: meeting.title,
        starts_at: meeting.starts_at,
        ends_at: meeting.ends_at,
        gcal_missing: false,
      });
    } else if (row.gcal_missing) {
      writes.push({ id: row.id, gcal_missing: false });
    }
  }
  return writes;
}
```

- [ ] **Step 4: Run to verify the pure-function tests pass**

Run: `npx vitest run src/lib/gcal.test.ts`
Expected: the five new `diffLinkedEvents` tests PASS; existing `syncCalendar` tests still PASS unchanged (nothing wired in yet).

- [ ] **Step 5: Write the failing integration test for `syncCalendar` wiring**

First, extend `fakeDb` in `src/lib/gcal.test.ts` so its `select()` chain supports `.not()` and `.in()`, and so `from()` supports `update()`. Replace the `fakeDb` function (lines 60–142) with:

```ts
function fakeDb(seed?: {
  periods?: PeriodSeed[];
  meetingDates?: string[];
  linkedEvents?: { id: string; gcal_event_id: string; name: string; starts_at: string; ends_at: string; gcal_missing: boolean }[];
  meetingsByGcalId?: { gcal_event_id: string; title: string; starts_at: string; ends_at: string }[];
}) {
  const calls: { table: string; rows: unknown; opts: unknown }[] = [];
  const deletes: { table: string; filters: { op: string; col: string; val: unknown }[] }[] = [];
  const updates: { table: string; patch: unknown; id: string }[] = [];
  const periods = seed?.periods ?? [];
  const meetingDates = seed?.meetingDates ?? [];
  const linkedEvents = seed?.linkedEvents ?? [];
  const meetingsByGcalId = seed?.meetingsByGcalId ?? [];
  return {
    calls,
    deletes,
    updates,
    client: {
      from(table: string) {
        return {
          upsert: async (rows: unknown, opts: unknown) => {
            calls.push({ table, rows, opts });
            return { error: null };
          },
          update(patch: unknown) {
            return {
              eq: async (_col: string, id: string) => {
                updates.push({ table, patch, id });
                return { error: null };
              },
            };
          },
          select(_cols: string) {
            let gteVal: string | undefined;
            let lteVal: string | undefined;
            let notNullCol: string | undefined;
            let inVal: string[] | undefined;
            const chain = {
              order() {
                return chain;
              },
              gte(_col: string, val: string) {
                gteVal = val;
                return chain;
              },
              lte(_col: string, val: string) {
                lteVal = val;
                return chain;
              },
              limit() {
                return chain;
              },
              not(col: string, _op: string, _val: unknown) {
                notNullCol = col;
                return chain;
              },
              in(_col: string, vals: string[]) {
                inVal = vals;
                return chain;
              },
              then(resolve: (v: { data: unknown; error: null }) => void) {
                if (table === "period") {
                  resolve({ data: periods, error: null });
                  return;
                }
                if (table === "event" && notNullCol === "gcal_event_id") {
                  // Linked events with ends_at >= gteVal.
                  const hit = linkedEvents.filter((e) => !gteVal || e.ends_at >= gteVal);
                  resolve({ data: hit, error: null });
                  return;
                }
                if (table === "meeting" && inVal) {
                  const hit = meetingsByGcalId.filter((m) => inVal!.includes(m.gcal_event_id));
                  resolve({ data: hit, error: null });
                  return;
                }
                // meeting existence (periodHasMeetings): any seeded meeting date within [gte, lte]?
                const hit = meetingDates.filter(
                  (d) => (!gteVal || d >= gteVal) && (!lteVal || d <= lteVal),
                );
                resolve({ data: hit.map((d) => ({ id: d })), error: null });
              },
            };
            return chain;
          },
          delete() {
            const filters: { op: string; col: string; val: unknown }[] = [];
            const chain = {
              eq(col: string, val: unknown) {
                filters.push({ op: "eq", col, val });
                return chain;
              },
              lt(col: string, val: unknown) {
                filters.push({ op: "lt", col, val });
                return chain;
              },
              lte(col: string, val: unknown) {
                filters.push({ op: "lte", col, val });
                return chain;
              },
              gte(col: string, val: unknown) {
                filters.push({ op: "gte", col, val });
                return chain;
              },
              not(col: string, op: string, val: unknown) {
                filters.push({ op: `not.${op}`, col, val });
                return chain;
              },
              // Thenable: awaiting the builder records the delete and resolves.
              then(resolve: (v: { error: null }) => void) {
                deletes.push({ table, filters });
                resolve({ error: null });
              },
            };
            return chain;
          },
        };
      },
    } as never,
  };
}
```

Then add this test inside the `describe("syncCalendar", ...)` block:

```ts
  test("reconciles a linked event against the freshly-synced meeting, and flags a deleted one", async () => {
    const db = fakeDb({
      linkedEvents: [
        // Still matches a meeting, but with stale name/time — gets updated.
        { id: "ev-stale", gcal_event_id: "evt-1", name: "Old Name", starts_at: "2020-01-01T00:00:00Z", ends_at: "2020-01-01T01:00:00Z", gcal_missing: false },
        // No longer has a matching meeting — gets flagged.
        { id: "ev-gone", gcal_event_id: "evt-missing", name: "Gone", starts_at: "2020-01-01T00:00:00Z", ends_at: "2020-01-01T01:00:00Z", gcal_missing: false },
      ],
      meetingsByGcalId: [
        { gcal_event_id: "evt-1", title: "Build Session", starts_at: "2026-09-02T03:00:00.000Z", ends_at: "2026-09-02T05:00:00.000Z" },
      ],
    });
    const events = [
      { id: "evt-1", summary: "Build Session", start: { dateTime: "2026-09-02T03:00:00Z" }, end: { dateTime: "2026-09-02T05:00:00Z" } },
    ];
    const result = await syncCalendar({
      fetch: fakeFetch(events),
      db: db.client,
      credentials: CREDS,
      tz: TZ,
      now: () => 1_700_000_000_000,
    });

    expect(result.linkedEventsUpdated).toBe(1);
    expect(db.updates).toContainEqual({
      table: "event",
      patch: { name: "Build Session", starts_at: "2026-09-02T03:00:00.000Z", ends_at: "2026-09-02T05:00:00.000Z", gcal_missing: false },
      id: "ev-stale",
    });
    expect(db.updates).toContainEqual({ table: "event", patch: { gcal_missing: true }, id: "ev-gone" });
  });
```

Update the four `expect(result).toEqual({ meetings: ..., buildDays: ..., backfilledPeriods: ... })` assertions already in the file (the "upserts meetings..." test, the all-day test, the "day is required if ANY..." test, and the "follows nextPageToken..." test) to add `linkedEventsUpdated: 0`, e.g.:

```ts
    expect(result).toEqual({ meetings: 1, buildDays: 1, backfilledPeriods: 0, linkedEventsUpdated: 0 });
```

Do the same for the "no events → no upserts" test and the three backfill tests (`toEqual({ ... })` / `result.backfilledPeriods` assertions that check the full object need the new field; ones that only check `result.backfilledPeriods` directly need no change).

- [ ] **Step 6: Run to verify the new test fails and the updated ones fail on the missing field**

Run: `npx vitest run src/lib/gcal.test.ts`
Expected: FAIL — `syncCalendar` doesn't return `linkedEventsUpdated` yet, and doesn't touch `event`/produce `db.updates`.

- [ ] **Step 7: Wire it into `syncCalendar()`**

In `src/lib/gcal.ts`:

1. Update `SyncResult`:

```ts
export type SyncResult = { meetings: number; buildDays: number; backfilledPeriods: number; linkedEventsUpdated: number };
```

2. Add this function after `fetchAllEvents` (before `syncCalendar`):

```ts
/**
 * Reconcile `event` rows linked to a calendar event against the meeting
 * table this same sync run just refreshed. Only events that haven't ended
 * yet are considered — matches the sync's own rolling-window philosophy, no
 * point chasing an event already over. Returns the count of events whose
 * name/starts_at/ends_at actually changed (not counting flag-only writes).
 */
async function syncLinkedEvents(db: SupabaseClient, nowIso: string): Promise<number> {
  const { data: linkedData } = await db
    .from("event")
    .select("id, gcal_event_id, name, starts_at, ends_at, gcal_missing")
    .not("gcal_event_id", "is", null)
    .gte("ends_at", nowIso);
  const linked = (linkedData ?? []) as LinkedEventRow[];
  if (linked.length === 0) return 0;

  const { data: meetingData } = await db
    .from("meeting")
    .select("gcal_event_id, title, starts_at, ends_at")
    .in("gcal_event_id", linked.map((r) => r.gcal_event_id));
  const meetingsByGcalId = new Map(
    ((meetingData ?? []) as MeetingLite[]).map((m) => [m.gcal_event_id, m] as const),
  );

  const writes = diffLinkedEvents(linked, meetingsByGcalId);
  for (const { id, ...patch } of writes) {
    await db.from("event").update(patch).eq("id", id);
  }
  return writes.filter((w) => w.name !== undefined).length;
}
```

3. In `syncCalendar`, change the final return to reconcile linked events first and include the count:

```ts
  const linkedEventsUpdated = await syncLinkedEvents(deps.db, new Date(nowMs).toISOString());
  return { meetings: meetingRows.length, buildDays: buildDayRows.length, backfilledPeriods, linkedEventsUpdated };
```

4. Also update the early-return for the empty-events case near the top of `syncCalendar` (`if (events.length === 0) return { meetings: 0, buildDays: 0, backfilledPeriods };`) — it should still reconcile linked events even when the calendar returned nothing new, since a deletion still needs to be caught:

```ts
  if (events.length === 0) {
    const linkedEventsUpdated = await syncLinkedEvents(deps.db, new Date(nowMs).toISOString());
    return { meetings: 0, buildDays: 0, backfilledPeriods, linkedEventsUpdated };
  }
```

- [ ] **Step 8: Run tests to verify everything passes**

Run: `npx vitest run src/lib/gcal.test.ts`
Expected: PASS (all `diffLinkedEvents` tests, the new `syncCalendar` reconciliation test, and the updated `toEqual` assertions)

- [ ] **Step 9: Full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib/gcal.ts src/lib/gcal.test.ts
git commit -m "feat: reconcile linked events against synced meetings during calendar sync"
```

---

### Task 6: `EventForm` — optional calendar-event picker

**Files:**
- Modify: `src/components/EventForm.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/events/gcal-candidates` (Task 4) → `{ candidates: { id: string; title: string; startsAt: string; endsAt: string }[] }`.
- Produces: same `POST /api/admin/events` body as before, plus `gcalEventId: string | null`.

No dedicated test file exists for this component in the repo (no `EventForm.test.tsx` present) — verification is manual in Step 3, matching how the rest of this component's coverage works today.

- [ ] **Step 1: Replace `src/components/EventForm.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Period } from "@/lib/types";

type GcalCandidate = { id: string; title: string; startsAt: string; endsAt: string };

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  const [candidates, setCandidates] = useState<GcalCandidate[]>([]);
  const [gcalEventId, setGcalEventId] = useState("");

  useEffect(() => {
    fetch("/api/admin/events/gcal-candidates")
      .then((res) => (res.ok ? res.json() : { candidates: [] }))
      .then((json) => setCandidates(json.candidates ?? []))
      .catch(() => setCandidates([]));
  }, []);

  function pickCandidate(id: string) {
    setGcalEventId(id);
    if (!id) return;
    const candidate = candidates.find((c) => c.id === id);
    if (!candidate) return;
    setName(candidate.title);
    setStartsAt(toDatetimeLocal(candidate.startsAt));
    setEndsAt(toDatetimeLocal(candidate.endsAt));
  }

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
          startsAt: startsAt ? new Date(startsAt).toISOString() : "",
          endsAt: endsAt ? new Date(endsAt).toISOString() : "",
          gcalEventId: gcalEventId || null,
        }),
      });
      if (res.ok) {
        setName("");
        setLocation("");
        setDescription("");
        setStartsAt("");
        setEndsAt("");
        setGcalEventId("");
        router.refresh();
      } else {
        setError("Could not create the event — check the dates and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const linked = gcalEventId !== "";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {candidates.length > 0 && (
        <label className="label">Attach to a calendar event (optional)
          <select className="input" value={gcalEventId} onChange={(e) => pickCandidate(e.target.value)}>
            <option value="">— Not linked —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({new Date(c.startsAt).toLocaleString()})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required disabled={linked} /></label>
      <label className="label">Period
        <select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="label">Location (optional)<input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="label">Description (optional)<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="label">Starts<input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required disabled={linked} /></label>
      <label className="label">Ends<input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required disabled={linked} /></label>
      {linked && <p className="text-sm text-[var(--muted)]">Name/dates are synced from Google Calendar and will update automatically.</p>}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">{busy ? "Saving…" : "Create event"}</button>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Manual verification in the browser**

Start the dev server, go to `/admin/events`, confirm:
- With no upcoming synced meetings, the picker is absent and the form behaves exactly as before.
- With at least one upcoming `meeting` row unclaimed by any event, the picker appears; selecting one disables and fills Name/Starts/Ends; submitting creates the event with the calendar's values; the event no longer appears in the picker on a fresh page load (already claimed).

- [ ] **Step 4: Commit**

```bash
git add src/components/EventForm.tsx
git commit -m "feat: add optional Google Calendar event picker to EventForm"
```

---

### Task 7: Roster page — flagged-link banner + unlink

**Files:**
- Create: `src/components/EventUnlinkBanner.tsx`
- Modify: `src/app/admin/events/[id]/page.tsx:1-35`

**Interfaces:**
- Consumes: `event.gcalMissing`, `event.gcalEventId` from Task 2/3; `POST /api/admin/events/:id/unlink` from Task 4.
- Produces: a banner rendered on the roster page when `event.gcalMissing` is true.

- [ ] **Step 1: Write `EventUnlinkBanner.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EventUnlinkBanner({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function unlink() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/unlink`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: "var(--yellow)" }}>
      <p>Linked Google Calendar event was deleted. The event details below are unaffected — you can unlink and manage this event manually.</p>
      <button type="button" onClick={unlink} disabled={busy} className="btn btn-secondary mt-2">
        {busy ? "Unlinking…" : "Unlink from calendar"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the roster page**

In `src/app/admin/events/[id]/page.tsx`, add the import:

```ts
import { EventUnlinkBanner } from "@/components/EventUnlinkBanner";
```

And render it right after the `page-head` div (before `<ManualAddPerson .../>`):

```tsx
      {event.gcalMissing && <EventUnlinkBanner eventId={id} />}

      <ManualAddPerson eventId={id} people={addable} />
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: Manual verification**

With a linked event, manually flip `gcal_missing` to `true` in the local DB for that row (simulating a sync having flagged it), reload `/admin/events/<id>`, confirm the banner appears; click "Unlink from calendar," confirm the banner disappears and the event's roster/data are untouched.

- [ ] **Step 5: Commit**

```bash
git add src/components/EventUnlinkBanner.tsx src/app/admin/events/[id]/page.tsx
git commit -m "feat: show unlink banner when a linked calendar event is deleted upstream"
```

---

## Final Verification

- [ ] Run the full suite: `npm test && npm run typecheck && npm run lint`
- [ ] Manually walk the golden path in the browser: create an event linked to a calendar event → confirm name/dates match → run the sync endpoint (or trigger it manually as mentor) → confirm no spurious changes → edit the underlying calendar event's time in Google Calendar → run sync again → confirm the `event` row's `starts_at`/`ends_at` updated → delete the calendar event → run sync → confirm the roster page shows the unlink banner.
