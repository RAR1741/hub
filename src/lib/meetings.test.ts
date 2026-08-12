import { describe, expect, test } from "vitest";
import {
  createManualMeeting, deleteMeeting, listUpcomingMeetings, parseMeetingInput, updateMeeting,
} from "./meetings";

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

describe("parseMeetingInput", () => {
  test("accepts a valid meeting and normalizes ISO datetimes", () => {
    expect(
      parseMeetingInput({
        title: " Build Session ",
        startsAt: "2026-09-01T18:00:00.000Z",
        endsAt: "2026-09-01T20:00:00Z",
      }),
    ).toEqual({
      title: "Build Session",
      startsAt: "2026-09-01T18:00:00.000Z",
      endsAt: "2026-09-01T20:00:00.000Z",
    });
  });

  test("accepts endsAt equal to startsAt", () => {
    const input = parseMeetingInput({
      title: "Instant",
      startsAt: "2026-09-01T18:00:00Z",
      endsAt: "2026-09-01T18:00:00Z",
    });
    expect(input).not.toBeNull();
  });

  test.each([
    [{ title: "", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" }], // missing title
    [{ title: "X", startsAt: "not-a-date", endsAt: "2026-09-01T20:00:00Z" }], // bad ISO start
    [{ title: "X", startsAt: "2026-09-01T18:00:00Z", endsAt: "not-a-date" }], // bad ISO end
    [{ title: "X", startsAt: "2026-09-01T20:00:00Z", endsAt: "2026-09-01T18:00:00Z" }], // endsAt < startsAt
    [{ title: "X", startsAt: "2026-09-01T18:00:00Z" }], // missing endsAt
    [null],
  ])("rejects %j", (body) => {
    expect(parseMeetingInput(body)).toBeNull();
  });
});

describe("createManualMeeting", () => {
  test("inserts with gcal_event_id = null", async () => {
    const captured: Record<string, unknown> = {};
    const db = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          captured.row = row;
          return {
            select: () => ({
              single: async () => ({ data: { id: "m1" }, error: null }),
            }),
          };
        },
      }),
    } as never;
    const result = await createManualMeeting(
      { title: "Build", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" },
      db,
    );
    expect(result).toEqual({ ok: true, id: "m1" });
    expect(captured.row).toMatchObject({ gcal_event_id: null, title: "Build" });
  });
});

describe("updateMeeting", () => {
  function fakeDb(found: boolean) {
    return {
      from: () => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: found ? { id: "m1" } : null, error: null }),
            }),
          }),
        }),
      }),
    } as never;
  }
  test("404 when missing", async () => {
    const result = await updateMeeting(
      "m1",
      { title: "X", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" },
      fakeDb(false),
    );
    expect(result).toEqual({ ok: false, status: 404 });
  });
  test("ok when found", async () => {
    const result = await updateMeeting(
      "m1",
      { title: "X", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" },
      fakeDb(true),
    );
    expect(result).toEqual({ ok: true, status: 200 });
  });
});

describe("deleteMeeting", () => {
  function fakeDb(found: boolean) {
    return {
      from: () => ({
        delete: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: found ? { id: "m1" } : null, error: null }),
            }),
          }),
        }),
      }),
    } as never;
  }
  test("404 when missing", async () => {
    expect(await deleteMeeting("m1", fakeDb(false))).toEqual({ ok: false, status: 404 });
  });
  test("ok when found", async () => {
    expect(await deleteMeeting("m1", fakeDb(true))).toEqual({ ok: true, status: 200 });
  });
});
