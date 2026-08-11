import { describe, expect, test } from "vitest";
import { listUpcomingMeetings } from "./meetings";

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
