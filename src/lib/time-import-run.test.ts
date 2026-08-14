import { describe, expect, test } from "vitest";
import { runTimeImport } from "./time-import-run";

// Minimal fake db capturing inserts/deletes. person select returns the injected roster (default: Ada).
function fakeDb(
  people: { id: string; first_name: string; last_name: string; display_name: string | null; role?: string }[] = [
    { id: "ada", first_name: "Ada", last_name: "Lovelace", display_name: null, role: "student" },
  ],
) {
  const roster = people.map((p) => ({ role: "student", ...p }));
  const calls = {
    sessionInsert: [] as Record<string, unknown>[],
    excusalUpsert: [] as Record<string, unknown>[],
    personInsert: [] as Record<string, unknown>[],
    personUpdate: [] as Record<string, unknown>[],
    deletes: [] as string[],
  };
  const db = {
    from(table: string) {
      if (table === "period") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pd1", name: "S", starts_on: "2026-01-01", ends_on: "2026-03-01", is_active: true } }) }) }) };
      }
      if (table === "app_setting") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "America/Indiana/Indianapolis" } }) }) }) };
      }
      if (table === "person") {
        return {
          select: () => ({ data: roster, error: null }),
          insert: (rows: Record<string, unknown>) => { calls.personInsert.push(rows); return { select: () => ({ single: async () => ({ data: { id: "new-1" }, error: null }) }) }; },
          update: (patch: Record<string, unknown>) => ({ eq: async (_col: string, val: string) => { calls.personUpdate.push({ ...patch, id: val }); return { error: null }; } }),
          delete: () => ({ eq: () => ({ eq: async () => { calls.deletes.push("session"); return { error: null }; } }) }),
        };
      }
      if (table === "session") {
        return {
          delete: () => ({ eq: () => ({ eq: async () => { calls.deletes.push("session"); return { error: null }; } }) }),
          insert: async (rows: Record<string, unknown>[]) => { calls.sessionInsert.push(...rows); return { error: null }; },
        };
      }
      if (table === "excusal") {
        return {
          delete: () => ({ eq: () => ({ gte: () => ({ lte: async () => { calls.deletes.push("excusal"); return { error: null }; } }) }) }),
          upsert: async (rows: Record<string, unknown>[]) => { calls.excusalUpsert.push(...rows); return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
  return { db, calls };
}

const SHEET = [
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Varsity',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  "Ada,Lovelace,0.00,18:29,20:58,OK,9:00,17:04,8:04,18:26,21:00,2:34,10",
  "New,Person,0.00,18:30,21:00,OK,,,0:00,,,0:00,3",
].join("\n");

const SPLIT_SHEET = [
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Varsity',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  "New,Student,0.00,18:30,21:00,OK,,,0:00,,,0:00,3",
  ",,,,,,,,,,,,",
  ",Full Time,,,,,,,,,,,",
  ",,,,,,,,,,,,",
  "New,Mentor,0.00,18:00,21:00,OK,,,0:00,,,0:00,7",
].join("\n");

describe("runTimeImport role changes", () => {
  // Roster has "New Mentor" as a student today; the sheet lists them in the mentor group.
  const roster = [{ id: "m1", first_name: "New", last_name: "Mentor", display_name: null, role: "student" }];

  test("dry-run proposes the role change and writes nothing", async () => {
    const { db, calls } = fakeDb(roster);
    const summary = await runTimeImport({ csv: SPLIT_SHEET, periodId: "pd1", importedBy: "admin-1", db, dryRun: true });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.dryRun).toBe(true);
    expect(summary.roleChanges).toEqual([{ name: "New Mentor", from: "student", to: "mentor" }]);
    expect(summary.roleChangesApplied).toBe(false);
    // The property the whole design rests on: a preview writes NOTHING.
    expect(calls.personInsert).toEqual([]);
    expect(calls.personUpdate).toEqual([]);
    expect(calls.sessionInsert).toEqual([]);
    expect(calls.deletes).toEqual([]);
  });

  test("confirmed import with applyRoleChanges updates the matched person's role", async () => {
    const { db, calls } = fakeDb(roster);
    const summary = await runTimeImport({ csv: SPLIT_SHEET, periodId: "pd1", importedBy: "admin-1", db, applyRoleChanges: true });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.roleChangesApplied).toBe(true);
    expect(calls.personUpdate).toContainEqual({ role: "mentor", id: "m1" });
    expect(calls.sessionInsert.length).toBeGreaterThan(0);
  });

  test("confirmed import without applyRoleChanges imports sessions but leaves roles alone", async () => {
    const { db, calls } = fakeDb(roster);
    const summary = await runTimeImport({ csv: SPLIT_SHEET, periodId: "pd1", importedBy: "admin-1", db, applyRoleChanges: false });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.roleChanges).toHaveLength(1);
    expect(summary.roleChangesApplied).toBe(false);
    expect(calls.personUpdate).toEqual([]);
    expect(calls.sessionInsert.length).toBeGreaterThan(0);
  });
});

describe("runTimeImport", () => {
  test("auto-created people get their role from the student/mentor split", async () => {
    const { db, calls } = fakeDb([]); // empty roster — both are created
    const summary = await runTimeImport({ csv: SPLIT_SHEET, periodId: "pd1", importedBy: "admin-1", db });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.createdStudents).toBe(1);
    expect(summary.createdMentors).toBe(1);
    const roles = Object.fromEntries(calls.personInsert.map((r) => [`${r.first_name} ${r.last_name}`, r.role]));
    expect(roles["New Student"]).toBe("student");
    expect(roles["New Mentor"]).toBe("mentor");
  });

  test("matches existing person, auto-creates unknown, inserts sessions with source=import", async () => {
    const { db, calls } = fakeDb();
    const summary = await runTimeImport({ csv: SHEET, periodId: "pd1", importedBy: "admin-1", db });
    if ("error" in summary) throw new Error(summary.error);

    expect(summary.matchedPeople).toBe(1);
    expect(summary.createdPeople).toBe(1);
    expect(summary.createdNames).toEqual(["New Person"]);
    // Two sessions (Ada x2), all tagged import, Ada mapped to her existing id.
    expect(calls.sessionInsert.every((s) => s.source === "import")).toBe(true);
    expect(calls.sessionInsert.some((s) => s.person_id === "ada")).toBe(true);
    // Replace deletes ran before insert.
    expect(calls.deletes).toContain("session");
    expect(calls.deletes).toContain("excusal");
  });

  test("a person whose display_name equals their own full name still matches (not ambiguous)", async () => {
    const { db } = fakeDb([{ id: "ada", first_name: "Ada", last_name: "Lovelace", display_name: "Ada Lovelace" }]);
    const summary = await runTimeImport({ csv: SHEET, periodId: "pd1", importedBy: "admin-1", db });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.matchedPeople).toBe(1);
    expect(summary.errors).toEqual([]);
  });

  test("a name matching two distinct people is reported ambiguous and not imported", async () => {
    const { db, calls } = fakeDb([
      { id: "a1", first_name: "Ada", last_name: "Lovelace", display_name: null },
      { id: "a2", first_name: "Ada", last_name: "Lovelace", display_name: null },
    ]);
    const summary = await runTimeImport({ csv: SHEET, periodId: "pd1", importedBy: "admin-1", db });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.matchedPeople).toBe(0);
    expect(summary.errors.some((e) => /ambiguous/i.test(e.message))).toBe(true);
    expect(calls.sessionInsert.some((s) => s.person_id === "a1" || s.person_id === "a2")).toBe(false);
  });
});
