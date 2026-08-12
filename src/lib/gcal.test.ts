import { describe, expect, test } from "vitest";
import {
  buildServiceAccountJwt,
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
      { date: "2026-03-15", kind: "required", source: "gcal" }, // verbatim, no tz shift
    ]);
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

    // Both pages were fetched, and each carried a timeMin bound derived from `now`.
    expect(requestedUrls).toHaveLength(2);
    const expectedTimeMin = new Date(1_700_000_000_000).toISOString();
    for (const href of requestedUrls) {
      expect(new URL(href).searchParams.get("timeMin")).toBe(expectedTimeMin);
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
