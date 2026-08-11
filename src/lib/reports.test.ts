import { describe, expect, test } from "vitest";
import { leaderboard } from "./reports";
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
