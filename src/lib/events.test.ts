import { describe, expect, test } from "vitest";
import { createEvent, deleteEvent, listGcalCandidates, parseEventInput, unlinkEvent } from "./events";

describe("parseEventInput", () => {
  const base = {
    name: "Robot Demo",
    periodId: "11111111-1111-1111-1111-111111111111",
    startsAt: "2027-03-01T18:00:00Z",
    endsAt: "2027-03-01T20:00:00Z",
  };

  // parseEventInput normalizes timestamps via toISOString()
  const normalized = {
    name: "Robot Demo",
    periodId: "11111111-1111-1111-1111-111111111111",
    startsAt: new Date(base.startsAt).toISOString(),
    endsAt: new Date(base.endsAt).toISOString(),
  };

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
