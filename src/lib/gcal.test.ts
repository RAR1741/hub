import { describe, expect, test } from "vitest";
import {
  buildServiceAccountJwt,
  isRequiredEvent,
  pickCalendarId,
  syncCalendar,
  type GcalTransport,
} from "./gcal";
import { generateKeyPairSync } from "node:crypto";

// A throwaway RSA key so buildServiceAccountJwt can actually sign in the test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

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

// Captures upsert + delete calls per table so we can assert what sync wrote.
function fakeDb() {
  const calls: { table: string; rows: unknown; opts: unknown }[] = [];
  const deletes: { table: string; filters: { op: string; col: string; val: unknown }[] }[] = [];
  return {
    calls,
    deletes,
    client: {
      from(table: string) {
        return {
          upsert: async (rows: unknown, opts: unknown) => {
            calls.push({ table, rows, opts });
            return { error: null };
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
              gte(col: string, val: unknown) {
                filters.push({ op: "gte", col, val });
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
      // Tue 23:00 local, not a Thursday-night / mandatory event → optional.
      { date: "2026-09-01", kind: "optional", source: "gcal" },
    ]);

    // gcal-owned build days are cleared before re-insert (re-sync reclassifies).
    expect(db.deletes).toContainEqual({
      table: "build_day",
      filters: [{ op: "eq", col: "source", val: "gcal" }],
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

    expect(result).toEqual({ meetings: 1, buildDays: 1 });

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
    expect(result).toEqual({ meetings: 3, buildDays: 2 });

    const buildDayCall = db.calls.find((c) => c.table === "build_day")!;
    expect(buildDayCall.rows).toEqual([
      { date: "2026-01-01", kind: "required", source: "gcal" },
      { date: "2026-01-02", kind: "optional", source: "gcal" },
    ]);

    // The two meeting deletes prune rows below timeMin and at/after timeMax.
    const meetingDeletes = db.deletes.filter((d) => d.table === "meeting");
    expect(meetingDeletes.map((d) => d.filters[0].op).sort()).toEqual(["gte", "lt"]);
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

    expect(result).toEqual({ meetings: 2, buildDays: 2 });

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
    expect(result).toEqual({ meetings: 0, buildDays: 0 });
    expect(db.calls).toHaveLength(0);
  });
});
