import { describe, expect, test } from "vitest";
import {
  buildServiceAccountJwt,
  diffLinkedEvents,
  isRequiredEvent,
  pickCalendarId,
  syncCalendar,
  type GcalTransport,
} from "./gcal";
import { localDateOf } from "./attendance";
import { generateKeyPairSync } from "node:crypto";

// A throwaway RSA key so buildServiceAccountJwt can actually sign in the test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const NOW = 1_700_000_000_000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const TZ = "America/Indiana/Indianapolis";
const ROLLING_MIN_ISO = new Date(NOW - YEAR_MS).toISOString();
const ROLLING_MAX_ISO = new Date(NOW + YEAR_MS).toISOString();
const CREDS = {
  clientEmail: "svc@proj.iam.gserviceaccount.com",
  privateKey: PEM,
  calendarId: "team@group.calendar.google.com",
};

describe("pickCalendarId", () => {
  test("the env var wins when set", () => {
    expect(pickCalendarId("env-cal@group.calendar.google.com", "db-cal@x")).toBe(
      "env-cal@group.calendar.google.com",
    );
  });
  test("falls back to the db setting when the env var is unset or empty", () => {
    expect(pickCalendarId(undefined, "db-cal@x")).toBe("db-cal@x");
    expect(pickCalendarId("", "db-cal@x")).toBe("db-cal@x");
    expect(pickCalendarId("   ", "db-cal@x")).toBe("db-cal@x");
  });
  test("trims, and returns empty string when neither is set", () => {
    expect(pickCalendarId("  env-cal  ", "")).toBe("env-cal");
    expect(pickCalendarId(undefined, undefined)).toBe("");
  });
});

describe("buildServiceAccountJwt", () => {
  test("produces a three-segment JWT", () => {
    const jwt = buildServiceAccountJwt(
      { clientEmail: "svc@proj.iam.gserviceaccount.com", privateKey: PEM },
      () => 1_700_000_000_000,
    );
    expect(jwt.split(".")).toHaveLength(3);
  });
});

type PeriodSeed = { id: string; starts_on: string; ends_on: string };

// Captures upsert + delete calls per table so we can assert what sync wrote.
// `seed.periods` feeds the season-calendar read; `seed.meetingDates` is the set
// of starts_at ISO strings a meeting exists on, so periodHasMeetings can answer
// range queries.
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

// Like fakeFetch, but serves distinct pages keyed by the pageToken query param
// (undefined for the first request), and records every events-endpoint URL requested.
function fakeFetchPaged(pages: { token: string | undefined; events: unknown[]; nextPageToken?: string }[]) {
  const requestedUrls: string[] = [];
  const transport = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (href.includes("/calendar/v3/calendars/")) {
      requestedUrls.push(href);
      const parsed = new URL(href);
      const pageToken = parsed.searchParams.get("pageToken") ?? undefined;
      const page = pages.find((p) => p.token === pageToken);
      if (!page) throw new Error(`no fake page for pageToken=${pageToken}`);
      const body: { items: unknown[]; nextPageToken?: string } = { items: page.events };
      if (page.nextPageToken) body.nextPageToken = page.nextPageToken;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${href}`);
  }) as unknown as GcalTransport;
  return { transport, requestedUrls };
}

describe("isRequiredEvent", () => {
  const TZ = "America/Indiana/Indianapolis";
  // 2026-01-01 is a Thursday; in January the zone is EST (UTC-5).
  test("a Thursday event at/after 5pm local is required", () => {
    expect(isRequiredEvent({ start: { dateTime: "2026-01-01T23:30:00Z" } }, TZ)).toBe(true); // 18:30 Thu
    expect(isRequiredEvent({ start: { dateTime: "2026-01-01T22:00:00Z" } }, TZ)).toBe(true); // 17:00 Thu
  });
  test("a Thursday afternoon (before 5pm) event is NOT required", () => {
    expect(isRequiredEvent({ start: { dateTime: "2026-01-01T21:00:00Z" } }, TZ)).toBe(false); // 16:00 Thu
  });
  test("a non-Thursday evening event is NOT required", () => {
    expect(isRequiredEvent({ start: { dateTime: "2026-01-02T23:30:00Z" } }, TZ)).toBe(false); // 18:30 Fri
  });
  test('any event whose title contains "mandatory" is required, regardless of day/time', () => {
    expect(isRequiredEvent({ summary: "Mandatory Kickoff", start: { dateTime: "2026-01-02T21:00:00Z" } }, TZ)).toBe(true);
    expect(isRequiredEvent({ summary: "MANDATORY competition", start: { date: "2026-03-15" } }, TZ)).toBe(true);
  });
  test("an all-day event without 'mandatory' is NOT required (no night time to check)", () => {
    expect(isRequiredEvent({ summary: "Competition Day", start: { date: "2026-01-01" } }, TZ)).toBe(false);
  });
});

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

describe("syncCalendar", () => {
  test("reconciles a linked event against the freshly-synced meeting, and flags a deleted one", async () => {
    const db = fakeDb({
      linkedEvents: [
        // Still matches a meeting, but with stale name/time — gets updated.
        { id: "ev-stale", gcal_event_id: "evt-1", name: "Old Name", starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-08-01T01:00:00Z", gcal_missing: false },
        // No longer has a matching meeting — gets flagged.
        { id: "ev-gone", gcal_event_id: "evt-missing", name: "Gone", starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-08-01T01:00:00Z", gcal_missing: false },
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

    expect(result).toEqual({ meetings: 1, buildDays: 1, backfilledPeriods: 0, linkedEventsUpdated: 0 });

    const meetingCall = db.calls.find((c) => c.table === "meeting")!;
    expect(meetingCall.opts).toEqual({ onConflict: "gcal_event_id" });
    expect(meetingCall.rows).toMatchObject([
      { gcal_event_id: "evt-1", title: "Build Session" },
    ]);

    const buildDayCall = db.calls.find((c) => c.table === "build_day")!;
    expect(buildDayCall.opts).toEqual({ onConflict: "date", ignoreDuplicates: true });
    expect(buildDayCall.rows).toEqual([
      // Tue 23:00 local, not a Thursday-night / mandatory event → optional.
      { date: "2026-09-01", kind: "optional", source: "gcal" },
    ]);

    // gcal-owned build days are cleared before re-insert (re-sync reclassifies),
    // scoped to the fetched local-date range (no periods → rolling window).
    expect(db.deletes).toContainEqual({
      table: "build_day",
      filters: [
        { op: "eq", col: "source", val: "gcal" },
        { op: "gte", col: "date", val: localDateOf(ROLLING_MIN_ISO, TZ) },
        { op: "lte", col: "date", val: localDateOf(ROLLING_MAX_ISO, TZ) },
      ],
    });
  });

  test("an all-day event's build_day uses the date verbatim, not a tz-shifted instant (fix #1)", async () => {
    const db = fakeDb();
    const events = [
      {
        id: "evt-allday",
        summary: "Competition Day",
        start: { date: "2026-03-15" },
        end: { date: "2026-03-16" },
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

    expect(result).toEqual({ meetings: 1, buildDays: 1, backfilledPeriods: 0, linkedEventsUpdated: 0 });

    const buildDayCall = db.calls.find((c) => c.table === "build_day")!;
    expect(buildDayCall.rows).toEqual([
      // verbatim date, no tz shift; all-day + no "mandatory" → optional
      { date: "2026-03-15", kind: "optional", source: "gcal" },
    ]);
  });

  test("a day is required if ANY of its events qualifies; else optional; and out-of-window meetings are pruned", async () => {
    const db = fakeDb();
    // Thu 2026-01-01: an afternoon demo (optional) + the 18:30 meeting (required) → day required.
    // Fri 2026-01-02: an evening event, not Thursday → optional.
    const events = [
      { id: "a", summary: "Afternoon Demo", start: { dateTime: "2026-01-01T21:00:00Z" }, end: { dateTime: "2026-01-01T22:00:00Z" } },
      { id: "b", summary: "FRC Team Meeting", start: { dateTime: "2026-01-01T23:30:00Z" }, end: { dateTime: "2026-01-02T02:00:00Z" } },
      { id: "c", summary: "Open Lab", start: { dateTime: "2026-01-02T23:30:00Z" }, end: { dateTime: "2026-01-03T01:00:00Z" } },
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
    expect(result).toEqual({ meetings: 3, buildDays: 2, backfilledPeriods: 0, linkedEventsUpdated: 0 });

    const buildDayCall = db.calls.find((c) => c.table === "build_day")!;
    expect(buildDayCall.rows).toEqual([
      { date: "2026-01-01", kind: "required", source: "gcal" },
      { date: "2026-01-02", kind: "optional", source: "gcal" },
    ]);

    // Three meeting deletes fire: the new stale-synced_at prune (scoped to the
    // fetch window), plus the far-past/far-future prunes below timeMin and
    // at/after timeMax. Exclude the synced_at prune to check the other two.
    const meetingDeletes = db.deletes
      .filter((d) => d.table === "meeting")
      .filter((d) => !d.filters.some((f) => f.col === "synced_at"));
    expect(meetingDeletes.map((d) => d.filters[0].op).sort()).toEqual(["gte", "lt"]);
    // Each prune is scoped to gcal-sourced rows only, so a manual (null
    // gcal_event_id) meeting outside the window is never deleted by sync.
    for (const del of meetingDeletes) {
      expect(del.filters).toContainEqual({ op: "not.is", col: "gcal_event_id", val: null });
    }
  });

  test("follows nextPageToken and upserts events from every page, with a timeMin window (fix #2)", async () => {
    const db = fakeDb();
    const page1Events = [
      {
        id: "evt-page1",
        summary: "Older Meeting",
        start: { dateTime: "2026-09-01T18:00:00Z" },
        end: { dateTime: "2026-09-01T20:00:00Z" },
      },
    ];
    const page2Events = [
      {
        id: "evt-page2",
        summary: "Newer Meeting",
        start: { dateTime: "2026-09-08T18:00:00Z" },
        end: { dateTime: "2026-09-08T20:00:00Z" },
      },
    ];
    const { transport, requestedUrls } = fakeFetchPaged([
      { token: undefined, events: page1Events, nextPageToken: "page-2-token" },
      { token: "page-2-token", events: page2Events },
    ]);

    const result = await syncCalendar({
      fetch: transport,
      db: db.client,
      credentials: {
        clientEmail: "svc@proj.iam.gserviceaccount.com",
        privateKey: PEM,
        calendarId: "team@group.calendar.google.com",
      },
      tz: "America/Indiana/Indianapolis",
      now: () => 1_700_000_000_000,
    });

    expect(result).toEqual({ meetings: 2, buildDays: 2, backfilledPeriods: 0, linkedEventsUpdated: 0 });

    const meetingCall = db.calls.find((c) => c.table === "meeting")!;
    expect(meetingCall.rows).toMatchObject([
      { gcal_event_id: "evt-page1" },
      { gcal_event_id: "evt-page2" },
    ]);

    // Both pages were fetched, each carrying the ±12-month window from `now`.
    expect(requestedUrls).toHaveLength(2);
    const YEAR = 365 * 24 * 60 * 60 * 1000;
    const expectedTimeMin = new Date(1_700_000_000_000 - YEAR).toISOString();
    const expectedTimeMax = new Date(1_700_000_000_000 + YEAR).toISOString();
    for (const href of requestedUrls) {
      const params = new URL(href).searchParams;
      expect(params.get("timeMin")).toBe(expectedTimeMin);
      expect(params.get("timeMax")).toBe(expectedTimeMax);
    }
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
    expect(result).toEqual({ meetings: 0, buildDays: 0, backfilledPeriods: 0, linkedEventsUpdated: 0 });
    expect(db.calls).toHaveLength(0);
  });

  // NOW (1_700_000_000_000) is 2023-11-14; the rolling window is 2022-11-14 →
  // 2024-11-13. These periods sit BEFORE that window, so they're backfill
  // candidates when they have no meetings.
  const OLD_PERIOD: PeriodSeed = { id: "p-old", starts_on: "2021-06-01", ends_on: "2021-12-31" };
  const MID_PERIOD: PeriodSeed = { id: "p-mid", starts_on: "2022-01-01", ends_on: "2022-05-31" };

  test("extends the fetch window back to an empty past period and counts it", async () => {
    const db = fakeDb({ periods: [OLD_PERIOD, MID_PERIOD], meetingDates: [] });
    const { transport, requestedUrls } = fakeFetchPaged([
      { token: undefined, events: [] },
    ]);
    const result = await syncCalendar({
      fetch: transport,
      db: db.client,
      credentials: CREDS,
      tz: TZ,
      now: () => NOW,
    });
    // Both past periods are empty → both backfilled.
    expect(result.backfilledPeriods).toBe(2);
    // The fetch window's timeMin is pulled back to the EARLIEST empty period's
    // start, not the rolling window's start.
    const params = new URL(requestedUrls[0]).searchParams;
    expect(params.get("timeMin")).toBe("2021-06-01T00:00:00Z");
    expect(params.get("timeMax")).toBe(ROLLING_MAX_ISO);
  });

  test("does NOT extend the window for a past period that already has meetings", async () => {
    // OLD_PERIOD has a meeting; MID_PERIOD is empty → only MID is backfilled,
    // window pulls back to MID's start (2022-01-01), not OLD's (2021-06-01).
    const db = fakeDb({ periods: [OLD_PERIOD, MID_PERIOD], meetingDates: ["2021-07-15T18:00:00Z"] });
    const { transport, requestedUrls } = fakeFetchPaged([
      { token: undefined, events: [] },
    ]);
    const result = await syncCalendar({
      fetch: transport,
      db: db.client,
      credentials: CREDS,
      tz: TZ,
      now: () => NOW,
    });
    expect(result.backfilledPeriods).toBe(1);
    expect(new URL(requestedUrls[0]).searchParams.get("timeMin")).toBe("2022-01-01T00:00:00Z");
  });

  test("prune bound is the earliest period's start, not the (dynamic) fetch window — so a fully-backfilled run keeps history", async () => {
    // Every past period already has meetings → no backfill, window collapses to
    // the rolling min. The far-past prune must STILL be bounded at the earliest
    // period (2021-06-01), or it would delete the backfilled history.
    const db = fakeDb({
      periods: [OLD_PERIOD, MID_PERIOD],
      meetingDates: ["2021-07-15T18:00:00Z", "2022-02-10T18:00:00Z"],
    });
    const events = [
      { id: "cur", summary: "Meeting", start: { dateTime: "2023-11-16T23:30:00Z" }, end: { dateTime: "2023-11-17T01:00:00Z" } },
    ];
    const result = await syncCalendar({
      fetch: fakeFetch(events),
      db: db.client,
      credentials: CREDS,
      tz: TZ,
      now: () => NOW,
    });
    expect(result.backfilledPeriods).toBe(0);

    // The far-past meeting prune uses the earliest period start, NOT rolling min.
    // Exclude the stale-synced_at prune (also an "lt" on starts_at, but scoped
    // to the fetch window and additionally filtered on synced_at).
    const meetingDeletes = db.deletes
      .filter((d) => d.table === "meeting")
      .filter((d) => !d.filters.some((f) => f.col === "synced_at"));
    const ltPrune = meetingDeletes.find((d) => d.filters.some((f) => f.op === "lt" && f.col === "starts_at"))!;
    expect(ltPrune.filters).toContainEqual({ op: "lt", col: "starts_at", val: "2021-06-01T00:00:00Z" });
  });

  test("prunes a meeting deleted from the calendar within the fetch window (fix: deletion detection), and flags its linked event", async () => {
    // A meeting inside the normal rolling window whose synced_at is from a
    // PRIOR run — this run's fetch no longer returns it, so it must be pruned.
    const db = fakeDb({
      linkedEvents: [
        { id: "ev-linked", gcal_event_id: "evt-deleted", name: "Old Meeting", starts_at: "2023-11-16T18:00:00Z", ends_at: "2023-11-16T20:00:00Z", gcal_missing: false },
      ],
      // Not present here — simulates the meeting row already being gone by the
      // time syncLinkedEvents reads (i.e. the prune above already removed it).
      meetingsByGcalId: [],
    });
    // The fetch returns some other, unrelated current event — "evt-deleted" is
    // simply absent from the calendar's response now.
    const events = [
      { id: "evt-current", summary: "Still There", start: { dateTime: "2023-11-16T23:30:00Z" }, end: { dateTime: "2023-11-17T01:00:00Z" } },
    ];
    const result = await syncCalendar({
      fetch: fakeFetch(events),
      db: db.client,
      credentials: CREDS,
      tz: TZ,
      now: () => NOW,
    });

    const syncedAtIso = new Date(NOW).toISOString();
    const meetingDeletes = db.deletes.filter((d) => d.table === "meeting");
    const staleDelete = meetingDeletes.find((d) => d.filters.some((f) => f.op === "lt" && f.col === "synced_at"));
    expect(staleDelete).toBeDefined();
    expect(staleDelete!.filters).toContainEqual({ op: "gte", col: "starts_at", val: ROLLING_MIN_ISO });
    expect(staleDelete!.filters).toContainEqual({ op: "lt", col: "starts_at", val: ROLLING_MAX_ISO });
    expect(staleDelete!.filters).toContainEqual({ op: "not.is", col: "gcal_event_id", val: null });
    expect(staleDelete!.filters).toContainEqual({ op: "lt", col: "synced_at", val: syncedAtIso });

    // With the meeting gone, diffLinkedEvents flags the linked event end-to-end.
    expect(db.updates).toContainEqual({ table: "event", patch: { gcal_missing: true }, id: "ev-linked" });
    expect(result.linkedEventsUpdated).toBe(0); // flag-only write doesn't count as a "changed" update
  });
});
