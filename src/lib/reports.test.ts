import { describe, expect, test } from "vitest";
import { flaggedSessions, leaderboard } from "./reports";
import type { Session } from "./types";

const s = (over: Partial<Session>): Session => ({
  id: "s", personId: "p", periodId: "pd", timeIn: "2026-09-01T18:00:00Z",
  timeOut: "2026-09-01T20:00:00Z", source: "kiosk", note: null,
  excludedFromTotals: false, editedBy: null, editedAt: null, ...over,
});

describe("leaderboard", () => {
  test("totals per person, sorted by hours desc", () => {
    const result = leaderboard([
      { personId: "p1", name: "Ada", sessions: [s({}), s({ timeOut: "2026-09-01T21:00:00Z" })] }, // 2 + 3 = 5
      { personId: "p2", name: "Bo", sessions: [s({})] }, // 2
    ]);
    expect(result).toEqual([
      { personId: "p1", name: "Ada", hours: 5, sessionCount: 2 },
      { personId: "p2", name: "Bo", hours: 2, sessionCount: 1 },
    ]);
  });
  test("excluded and open sessions don't add hours but count as sessions", () => {
    const [entry] = leaderboard([
      { personId: "p1", name: "Ada", sessions: [s({ excludedFromTotals: true }), s({ timeOut: null })] },
    ]);
    expect(entry.hours).toBe(0);
    expect(entry.sessionCount).toBe(2);
  });
});

// Minimal fake db: "app_setting" resolves max_shift_hours, "session" returns the given rows.
function fakeDb(rows: Record<string, unknown>[]) {
  return {
    from(table: string) {
      if (table === "app_setting") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: rows, error: null }),
          }),
        }),
      };
    },
  } as never;
}

const row = (over: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "s1", person_id: "p1", period_id: "pd", time_in: "2026-09-01T18:00:00Z",
  time_out: "2026-09-01T20:00:00Z", source: "kiosk", note: null,
  excluded_from_totals: false, edited_by: null, edited_at: null,
  person: { id: "p1", first_name: "Ada", last_name: "Lovelace", display_name: null },
  ...over,
});

describe("flaggedSessions", () => {
  test("includes only sessions with flags or overlaps", async () => {
    const db = fakeDb([
      row({ id: "s1", time_out: null }), // still_open flag
      row({
        id: "s2", person_id: "p2",
        person: { id: "p2", first_name: "Bo", last_name: "Jones", display_name: null },
      }), // different person, clean, closed, no flags, no overlap
    ]);
    const result = await flaggedSessions("pd", db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Ada Lovelace",
      flags: ["still_open"],
      overlapping: false,
    });
  });

  test("returns empty when nothing is flagged", async () => {
    const db = fakeDb([row({ id: "s1" })]);
    expect(await flaggedSessions("pd", db)).toEqual([]);
  });
});
