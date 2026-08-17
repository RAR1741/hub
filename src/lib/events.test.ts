import { describe, expect, test } from "vitest";
import { deleteEvent, parseEventInput } from "./events";

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
    });
  });

  test("accepts and trims optional location/description", () => {
    expect(parseEventInput({ ...base, location: " Library ", description: " Bring robot " })).toEqual({
      ...normalized,
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
