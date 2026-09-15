import { describe, expect, test } from "vitest";
import { attendanceSummaryForPeriod } from "./attendance";
import { getBadge } from "./badges";
import { getBattery } from "./batteries";
import { getEvent } from "./events";
import { listExcusals } from "./excusals";
import { getConnection } from "./onshape";
import { getPart, getProject } from "./parts";
import { findPersonForRosterRow, getPersonWithTeams } from "./people";
import { getActivePeriod, getPeriod } from "./periods";
import { sessionsForPeriod } from "./reports";
import { getTeam } from "./teams";
import { getTool } from "./tools";
import { resolveViewer } from "./viewer";

/**
 * A failed read is not "no such row" (#287). Every read below fetches a single
 * entity or a required prior state, so swallowing `error` would turn a broken
 * database into a confident 404 (or an empty report). Each must throw instead,
 * so the page lands in error.tsx and the API route 500s.
 */

const ERR = { message: "boom", details: "", hint: "", code: "57014" };

/** A db whose every read fails, however the query is chained. */
function failingDb() {
  const chain: Record<string, unknown> = {
    maybeSingle: async () => ({ data: null, error: ERR }),
    single: async () => ({ data: null, error: ERR }),
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: ERR }),
  };
  for (const m of ["select", "eq", "gte", "lte", "in", "not", "order", "limit", "range"]) {
    chain[m] = () => chain;
  }
  return { from: () => chain } as never;
}

describe("a failed read throws instead of looking like a missing row", () => {
  const db = failingDb();

  test.each([
    ["getBadge", () => getBadge("b1", db)],
    ["getBattery", () => getBattery("b1", db)],
    ["getEvent", () => getEvent("e1", db)],
    ["getPart", () => getPart("p1", db)],
    ["getProject", () => getProject("p1", db)],
    ["getTeam", () => getTeam("t1", db)],
    ["getTool", () => getTool("t1", db)],
    ["getActivePeriod", () => getActivePeriod(db)],
    ["getPeriod", () => getPeriod("pe1", db)],
    ["getConnection", () => getConnection("p1", db)],
    ["getPersonWithTeams", () => getPersonWithTeams("p1", db)],
    ["attendanceSummaryForPeriod", () => attendanceSummaryForPeriod("pe1", db)],
    ["listExcusals", () => listExcusals({ from: "2026-01-01", to: "2026-02-01" }, db)],
    ["sessionsForPeriod", () => sessionsForPeriod("pe1", db)],
  ])("%s rejects", async (name, call) => {
    await expect(call()).rejects.toThrow(/boom/);
    await expect(call()).rejects.toThrow(new RegExp(name.replace(/([()])/g, "\\$1")));
  });

  test("findPersonForRosterRow throws rather than reporting 'no such person'", async () => {
    // The importer would otherwise create a duplicate of an existing person.
    await expect(
      findPersonForRosterRow({ email: "ada@example.org", studentIdNumber: null }, db),
    ).rejects.toThrow(/identity query failed/);
    await expect(
      findPersonForRosterRow({ email: null, studentIdNumber: "1741" }, db),
    ).rejects.toThrow(/student-id query failed/);
  });

  test("resolveViewer propagates a lookup failure instead of degrading to guest", async () => {
    const deps = {
      supabaseUserId: "auth-1",
      studentToken: null,
      verifyToken: async () => null,
      findPersonByAuthUserId: async () => {
        throw new Error("getViewer: identity lookup failed: boom");
      },
      findPersonById: async () => null,
      panelToken: null,
      verifyPanelToken: async () => null,
    };
    await expect(resolveViewer(deps)).rejects.toThrow(/identity lookup failed/);
  });
});
