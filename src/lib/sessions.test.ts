import { describe, expect, test } from "vitest";
import { activeMembersForKiosk, listWhosHere } from "./sessions";

// Generic chained-query stub in the style of attendance.test.ts: select/eq/is/
// order all return the same chain object; the chain is thenable so `await`ing
// the builder resolves to whatever result was registered for that table.
function fakeDb(tables: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order"]) {
        chain[m] = () => chain;
      }
      chain.then = (onF: (v: unknown) => unknown) => onF(result);
      return chain;
    },
  } as never;
}

const person = (over: Record<string, unknown>) => ({
  id: "p", first_name: "First", last_name: "Last", display_name: null, role: "student",
  is_active: true, ...over,
});

describe("activeMembersForKiosk", () => {
  test("splits active, not-clocked-in members into students and mentors, each sorted by name", async () => {
    const db = fakeDb({
      person: {
        data: [
          person({ id: "s1", first_name: "Bo", last_name: "Zed", role: "student" }),
          person({ id: "s2", first_name: "Ada", last_name: "Ng", role: "student" }),
          person({ id: "m1", first_name: "Cy", last_name: "Ma", role: "mentor" }),
          person({ id: "a1", first_name: "Al", last_name: "Ba", role: "admin" }),
        ],
        error: null,
      },
      session: { data: [], error: null },
    });

    const { students, mentors } = await activeMembersForKiosk(db);

    expect(students.map((m) => m.name)).toEqual(["Ada Ng", "Bo Zed"]);
    expect(students.every((m) => m.role === "student")).toBe(true);
    // admin counts as a mentor (role !== "student"); sorted by name
    expect(mentors.map((m) => m.name)).toEqual(["Al Ba", "Cy Ma"]);
    expect(mentors.map((m) => m.role)).toEqual(["admin", "mentor"]);
  });

  test("excludes members with an open session", async () => {
    const db = fakeDb({
      person: {
        data: [
          person({ id: "s1", first_name: "Ada", last_name: "Ng", role: "student" }),
          person({ id: "m1", first_name: "Cy", last_name: "Ma", role: "mentor" }),
        ],
        error: null,
      },
      session: { data: [{ person_id: "s1" }], error: null },
    });

    const { students, mentors } = await activeMembersForKiosk(db);
    expect(students).toEqual([]);
    expect(mentors.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("listWhosHere", () => {
  test("carries role through from the joined person", async () => {
    const db = fakeDb({
      session: {
        data: [
          {
            time_in: "2026-09-01T18:00:00Z",
            person: { id: "m1", first_name: "Cy", last_name: "Ma", display_name: null, role: "mentor" },
          },
          {
            time_in: "2026-09-01T18:05:00Z",
            person: { id: "s1", first_name: "Ada", last_name: "Ng", display_name: null, role: "student" },
          },
        ],
        error: null,
      },
    });

    const here = await listWhosHere(db);
    expect(here).toEqual([
      { personId: "m1", name: "Cy Ma", since: "2026-09-01T18:00:00Z", role: "mentor" },
      { personId: "s1", name: "Ada Ng", since: "2026-09-01T18:05:00Z", role: "student" },
    ]);
  });
});
