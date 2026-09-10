import { describe, expect, test } from "vitest";
import { activeMembersForKiosk, listAbsentMembers, listWhosHere } from "./sessions";

// Generic chained-query stub in the style of attendance.test.ts: select/eq/is/
// order/limit all return the same chain object; the chain is thenable so
// `await`ing the builder resolves to whatever result was registered for that
// table.
function fakeDb(tables: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit"]) {
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

describe("listAbsentMembers", () => {
  test("excludes a member with an open session", async () => {
    const db = fakeDb({
      person: {
        data: [
          person({ id: "s1", first_name: "Ada", last_name: "Ng", role: "student", session: [] }),
          person({ id: "m1", first_name: "Cy", last_name: "Ma", role: "mentor", session: [] }),
        ],
        error: null,
      },
      session: { data: [{ person_id: "s1" }], error: null },
    });

    const absent = await listAbsentMembers(db);
    expect(absent.map((m) => m.id)).toEqual(["m1"]);
  });

  test("fails closed (returns []) when the open-session query errors, even if people are active", async () => {
    const db = fakeDb({
      person: {
        data: [
          person({ id: "s1", first_name: "Ada", last_name: "Ng", role: "student", session: [] }),
          person({ id: "m1", first_name: "Cy", last_name: "Ma", role: "mentor", session: [] }),
        ],
        error: null,
      },
      session: { data: null, error: { message: "boom" } },
    });

    const absent = await listAbsentMembers(db);
    expect(absent).toEqual([]);
  });

  test("orders never-seen first, then ascending by lastSeen, passing the raw ISO string through", async () => {
    const db = fakeDb({
      person: {
        data: [
          person({
            id: "seen-late", first_name: "Zed", last_name: "Later", role: "student",
            session: [{ time_in: "2026-09-05T10:00:00Z" }],
          }),
          person({
            id: "never", first_name: "Ada", last_name: "New", role: "student",
            session: [],
          }),
          person({
            id: "seen-early", first_name: "Bo", last_name: "Early", role: "mentor",
            session: [{ time_in: "2026-09-01T10:00:00Z" }],
          }),
        ],
        error: null,
      },
      session: { data: [], error: null },
    });

    const absent = await listAbsentMembers(db);
    expect(absent.map((m) => ({ id: m.id, lastSeen: m.lastSeen }))).toEqual([
      { id: "never", lastSeen: null },
      { id: "seen-early", lastSeen: "2026-09-01T10:00:00Z" },
      { id: "seen-late", lastSeen: "2026-09-05T10:00:00Z" },
    ]);
  });

  test("names come from displayName, and every role is included", async () => {
    const db = fakeDb({
      person: {
        data: [
          person({ id: "s1", first_name: "Ada", last_name: "Ng", role: "student", session: [] }),
          person({ id: "m1", first_name: "Cy", last_name: "Ma", role: "mentor", session: [] }),
          person({ id: "a1", first_name: "Al", last_name: "Ba", role: "admin", session: [] }),
        ],
        error: null,
      },
      session: { data: [], error: null },
    });

    const absent = await listAbsentMembers(db);
    expect(absent.map((m) => m.name).sort()).toEqual(["Ada Ng", "Al Ba", "Cy Ma"]);
    expect(absent.map((m) => m.role).sort()).toEqual(["admin", "mentor", "student"]);
  });
});
