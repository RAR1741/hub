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
