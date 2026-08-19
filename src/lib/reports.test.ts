import { describe, expect, test } from "vitest";
import {
  dietaryRestrictionsReport, flaggedSessions, hoursReportForPeriod, leaderboard,
  listSessionsForPeriod, periodLeaderboard, personPeriodHours, sessionsForPeriod,
} from "./reports";
import type { Session } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

const s = (over: Partial<Session>): Session => ({
  id: "s", personId: "p", periodId: "pd", timeIn: "2026-09-01T18:00:00Z",
  timeOut: "2026-09-01T20:00:00Z", source: "kiosk", note: null,
  excludedFromTotals: false, editedBy: null, editedAt: null, flagsResolvedAt: null, eventId: null, ...over,
});

// Fake db that pages session rows via .range() — mirrors PostgREST's 1000 cap.
type Chain = {
  select: () => Chain;
  eq: () => Chain;
  order: () => Chain;
  range: (f: number, t: number) => Promise<{ data: Record<string, unknown>[] | null; error: null }>;
};
function pagedSessionDb(rows: Record<string, unknown>[]): SupabaseClient {
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: (f, t) => Promise.resolve({ data: rows.slice(f, t + 1), error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("periodLeaderboard pagination", () => {
  test("aggregates people whose sessions fall beyond the 1000-row cap", async () => {
    // 1500 sessions: A rows 0-499, B 500-999, C 1000-1499. Pre-fix, C (past the
    // cap) vanished entirely — the exact leaderboard bug.
    const rows = Array.from({ length: 1500 }, (_, i) => {
      const pid = i < 500 ? "A" : i < 1000 ? "B" : "C";
      return {
        id: `s${String(i).padStart(4, "0")}`, person_id: pid, period_id: "pd",
        time_in: "2026-01-08T18:00:00Z", time_out: "2026-01-08T20:00:00Z",
        source: "import", note: null, excluded_from_totals: false, edited_by: null, edited_at: null,
        person: { id: pid, first_name: pid, last_name: "X", display_name: null, role: "student" },
      };
    });
    const entries = await periodLeaderboard("pd", pagedSessionDb(rows));
    expect(entries.map((e) => e.personId).sort()).toEqual(["A", "B", "C"]);
    expect(entries.find((e) => e.personId === "C")?.sessionCount).toBe(500);
  });
});

describe("leaderboard", () => {
  test("totals per person, sorted by hours desc", () => {
    const result = leaderboard([
      { personId: "p1", name: "Ada", firstName: "Ada", lastName: "Lovelace", role: "student", sessions: [s({}), s({ timeOut: "2026-09-01T21:00:00Z" })] }, // 2 + 3 = 5
      { personId: "p2", name: "Bo", firstName: "Bo", lastName: "Peep", role: "mentor", sessions: [s({})] }, // 2
    ]);
    expect(result).toEqual([
      { personId: "p1", name: "Ada", firstName: "Ada", lastName: "Lovelace", role: "student", hours: 5, sessionCount: 2 },
      { personId: "p2", name: "Bo", firstName: "Bo", lastName: "Peep", role: "mentor", hours: 2, sessionCount: 1 },
    ]);
  });
  test("excluded and open sessions don't add hours but count as sessions", () => {
    const [entry] = leaderboard([
      { personId: "p1", name: "Ada", firstName: "Ada", lastName: "Lovelace", role: "student", sessions: [s({ excludedFromTotals: true }), s({ timeOut: null })] },
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
      const b = {
        select: () => b, eq: () => b, order: () => b,
        range: async (f: number, t: number) => ({ data: rows.slice(f, t + 1), error: null }),
      };
      return b;
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

  test("excludes a session an admin resolved, even if it still carries a flag", async () => {
    const db = fakeDb([
      // still_open, but resolved → hidden
      row({ id: "s1", time_out: null, flags_resolved_at: "2026-09-02T12:00:00Z" }),
      // still_open, unresolved → shown
      row({ id: "s2", person_id: "p2", time_out: null, flags_resolved_at: null,
        person: { id: "p2", first_name: "Bo", last_name: "Jones", display_name: null } }),
    ]);
    const result = await flaggedSessions("pd", db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Bo Jones", flags: ["still_open"] });
  });
});

describe("sessionsForPeriod", () => {
  test("maps rows to Session[]", async () => {
    const rows = [
      {
        id: "s1", person_id: "p1", period_id: "pd1",
        time_in: "2026-09-01T18:00:00Z", time_out: "2026-09-01T20:00:00Z",
        source: "kiosk", note: null, excluded_from_totals: false, edited_by: null, edited_at: null,
      },
    ];
    const db = {
      from: () => {
        const b = {
          select: () => b, eq: () => b, order: () => b,
          range: async (f: number, t: number) => ({ data: rows.slice(f, t + 1), error: null }),
        };
        return b;
      },
    } as never;
    const result = await sessionsForPeriod("pd1", db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "s1", personId: "p1", timeIn: "2026-09-01T18:00:00Z" });
  });
});

describe("listSessionsForPeriod", () => {
  // Tracks .eq() calls so tests can assert whether personId narrowed the query.
  function fakeDb(rows: Record<string, unknown>[]) {
    const eqCalls: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq(col: string, val: unknown) {
        eqCalls.push([col, val]);
        return builder;
      },
      order: () => builder,
      range: async (f: number, t: number) => ({ data: rows.slice(f, t + 1), error: null }),
    };
    return { db: { from: () => builder } as never, eqCalls };
  }

  test("maps rows newest-first with the member's display name", async () => {
    const rows = [row({ id: "s1" })];
    const { db } = fakeDb(rows);
    const result = await listSessionsForPeriod("pd", undefined, db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "s1", personId: "p1", name: "Ada Lovelace" });
  });

  test("without personId, filters only by period_id", async () => {
    const { db, eqCalls } = fakeDb([row({ id: "s1" })]);
    await listSessionsForPeriod("pd", undefined, db);
    // Paged reads re-apply the filters per page; assert what's filtered, not how many pages.
    expect(eqCalls).toContainEqual(["period_id", "pd"]);
    expect(eqCalls.some((c) => c[0] === "person_id")).toBe(false);
  });

  test("with personId, also filters by person_id", async () => {
    const { db, eqCalls } = fakeDb([row({ id: "s1" })]);
    await listSessionsForPeriod("pd", "p1", db);
    expect(eqCalls).toContainEqual(["period_id", "pd"]);
    expect(eqCalls).toContainEqual(["person_id", "p1"]);
  });

  test("falls back to 'Unknown' when the person embed is missing", async () => {
    const { db } = fakeDb([row({ id: "s1", person: null })]);
    const result = await listSessionsForPeriod("pd", undefined, db);
    expect(result[0].name).toBe("Unknown");
  });
});

describe("personPeriodHours", () => {
  test("sums the person's closed sessions", async () => {
    const rows = [
      { id: "s1", person_id: "p1", period_id: "pd1", time_in: "2026-09-01T18:00:00Z",
        time_out: "2026-09-01T20:00:00Z", source: "kiosk", note: null,
        excluded_from_totals: false, edited_by: null, edited_at: null },
    ];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ order: async () => ({ data: rows, error: null }) }) }),
        }),
      }),
    } as never;
    expect(await personPeriodHours("p1", "pd1", db)).toBe(2);
  });
});

describe("hoursReportForPeriod", () => {
  function fakeDb(sessionRows: Record<string, unknown>[], personRows: Record<string, unknown>[]) {
    return {
      from(table: string) {
        if (table === "session") {
          const b = {
            select: () => b, eq: () => b, order: () => b,
            range: async (f: number, t: number) => ({ data: sessionRows.slice(f, t + 1), error: null }),
          };
          return b;
        }
        // person
        return { select: () => ({ order: async () => ({ data: personRows, error: null }) }) };
      },
    } as never;
  }

  test("includes active people with zero sessions, alongside people with logged hours", async () => {
    const sessionRows = [row({ id: "s1", person_id: "p1" })]; // 2h
    const personRows = [
      { id: "p1", first_name: "Ada", last_name: "Lovelace", display_name: null, role: "student", grad_year: null, email: null, is_active: true, student_id_number: "1001" },
      { id: "p2", first_name: "Bo", last_name: "Jones", display_name: null, role: "student", grad_year: null, email: null, is_active: true, student_id_number: "1002" },
      { id: "p3", first_name: "Cy", last_name: "Inactive", display_name: null, role: "student", grad_year: null, email: null, is_active: false, student_id_number: "1003" },
    ];
    const db = fakeDb(sessionRows, personRows);

    const result = await hoursReportForPeriod("pd", db);

    expect(result).toEqual([
      { personId: "p1", name: "Ada Lovelace", studentId: "1001", hours: 2 },
      { personId: "p2", name: "Bo Jones", studentId: "1002", hours: 0 },
    ]);
  });
});

describe("dietaryRestrictionsReport", () => {
  function fakeDb(personRows: Record<string, unknown>[]) {
    return {
      from() {
        return { select: () => ({ order: async () => ({ data: personRows, error: null }) }) };
      },
    } as never;
  }

  test("includes only active people with a non-empty dietary restriction, sorted by name", async () => {
    const personRows = [
      { id: "p1", first_name: "Zed", last_name: "Zephyr", display_name: null, role: "student", grad_year: null, email: null, is_active: true, student_id_number: null, dietary_restrictions: "Peanut" },
      { id: "p2", first_name: "Ada", last_name: "Lovelace", display_name: null, role: "mentor", grad_year: null, email: null, is_active: true, student_id_number: null, dietary_restrictions: "  " },
      { id: "p3", first_name: "Bo", last_name: "Jones", display_name: null, role: "student", grad_year: null, email: null, is_active: true, student_id_number: null, dietary_restrictions: null },
      { id: "p4", first_name: "Cy", last_name: "Inactive", display_name: null, role: "student", grad_year: null, email: null, is_active: false, student_id_number: null, dietary_restrictions: "Vegan" },
      { id: "p5", first_name: "Amy", last_name: "Adams", display_name: null, role: "student", grad_year: null, email: null, is_active: true, student_id_number: null, dietary_restrictions: " Gluten-free " },
    ];
    const db = fakeDb(personRows);

    const result = await dietaryRestrictionsReport(db);

    expect(result).toEqual([
      { personId: "p5", firstName: "Amy", lastName: "Adams", name: "Amy Adams", role: "student", dietaryRestrictions: "Gluten-free" },
      { personId: "p1", firstName: "Zed", lastName: "Zephyr", name: "Zed Zephyr", role: "student", dietaryRestrictions: "Peanut" },
    ]);
  });
});
