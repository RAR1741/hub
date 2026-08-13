import { describe, expect, test, vi } from "vitest";
import { runTimeImport } from "./time-import-run";

// Minimal fake db capturing inserts/deletes. person select returns one match (Ada).
function fakeDb() {
  const calls = { sessionInsert: [] as any[], excusalUpsert: [] as any[], personInsert: [] as any[], deletes: [] as string[] };
  const db: any = {
    from(table: string) {
      if (table === "period") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pd1", name: "S", starts_on: "2026-01-01", ends_on: "2026-03-01", is_active: true } }) }) }) };
      }
      if (table === "app_setting") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "America/Indiana/Indianapolis" } }) }) }) };
      }
      if (table === "person") {
        return {
          select: () => ({ data: [{ id: "ada", first_name: "Ada", last_name: "Lovelace", display_name: null }], error: null }),
          insert: (rows: any) => { calls.personInsert.push(rows); return { select: () => ({ single: async () => ({ data: { id: "new-1" }, error: null }) }) }; },
          delete: () => ({ eq: () => ({ eq: async () => { calls.deletes.push("session"); return { error: null }; } }) }),
        };
      }
      if (table === "session") {
        return {
          delete: () => ({ eq: () => ({ eq: async () => { calls.deletes.push("session"); return { error: null }; } }) }),
          insert: async (rows: any[]) => { calls.sessionInsert.push(...rows); return { error: null }; },
        };
      }
      if (table === "excusal") {
        return {
          delete: () => ({ eq: () => ({ gte: () => ({ lte: async () => { calls.deletes.push("excusal"); return { error: null }; } }) }) }),
          upsert: async (rows: any[]) => { calls.excusalUpsert.push(...rows); return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db, calls };
}

const SHEET = [
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Varsity',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  "Ada,Lovelace,0.00,18:29,20:58,OK,9:00,17:04,8:04,18:26,21:00,2:34,10",
  "New,Person,0.00,18:30,21:00,OK,,,0:00,,,0:00,3",
].join("\n");

describe("runTimeImport", () => {
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
});
