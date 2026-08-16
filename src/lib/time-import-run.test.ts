import { describe, expect, test } from "vitest";
import { runTimeImport } from "./time-import-run";

// Minimal fake db capturing inserts/deletes. person select returns the injected roster (default: Ada).
function fakeDb(
  people: { id: string; first_name: string; last_name: string; display_name: string | null; role?: string }[] = [
    { id: "ada", first_name: "Ada", last_name: "Lovelace", display_name: null, role: "student" },
  ],
  aliases: { person_id: string; name_key: string }[] = [],
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
      if (table === "person_name_alias") {
        return { select: () => ({ data: aliases, error: null }) };
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

// Flag Person's Jan 8 session is 18:00 -> 17:00 (overnight, 23h) => over_max_shift.
const ANOMALY_SHEET = [
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Varsity',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  "Flag,Person,0.00,18:00,17:00,OK,,,0:00,,,0:00,3",
].join("\n");
const FLAG_KEY = "Flag|Person|2026-01-08";

// Evening column (Eve/Fred confident 18:2x, no clock-out) flips Mort's bare
// "8:46" to PM → am_pm_uncertain, so his clock-in is decidable AM vs PM.
const AMPM_SHEET = [
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Varsity',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  "Eve,Evening,0.00,18:30,,OK,,,0:00,,,0:00,5",
  "Fred,Evening,0.00,18:20,,OK,,,0:00,,,0:00,5",
  "Mort,Morning,0.00,8:46,21:15,OK,,,0:00,,,0:00,12",
].join("\n");
const MORT_KEY = "Mort|Morning|2026-01-08";

describe("runTimeImport AM/PM decisions", () => {
  test("an undecided ambiguous clock-in errors and writes nothing", async () => {
    const { db, calls } = fakeDb([]);
    const r = await runTimeImport({ csv: AMPM_SHEET, periodId: "pd1", importedBy: "a", db });
    expect(r).toEqual({ error: "undecided_anomalies" });
    expect(calls.sessionInsert).toEqual([]);
  });

  test("AM vs PM changes the imported clock-in by 12h", async () => {
    const am = fakeDb([]); const pm = fakeDb([]);
    const rAm = await runTimeImport({ csv: AMPM_SHEET, periodId: "pd1", importedBy: "a", db: am.db, decisions: { [MORT_KEY]: "am" } });
    const rPm = await runTimeImport({ csv: AMPM_SHEET, periodId: "pd1", importedBy: "a", db: pm.db, decisions: { [MORT_KEY]: "pm" } });
    if ("error" in rAm || "error" in rPm) throw new Error("unexpected error");
    const inAm = new Date(am.calls.sessionInsert[0].time_in as string).getTime();
    const inPm = new Date(pm.calls.sessionInsert[0].time_in as string).getTime();
    expect((inPm - inAm) / 3_600_000).toBe(12); // 08:46 vs 20:46
  });

  test("reject skips the ambiguous session", async () => {
    const { db, calls } = fakeDb([]);
    const r = await runTimeImport({ csv: AMPM_SHEET, periodId: "pd1", importedBy: "a", db, decisions: { [MORT_KEY]: "reject" } });
    if ("error" in r) throw new Error(r.error);
    expect(calls.sessionInsert).toEqual([]);
    expect(r.skipped).toContainEqual({ name: "Mort Morning", date: "2026-01-08", reason: "rejected in preview" });
  });
});

describe("runTimeImport anomaly decisions", () => {
  test("a real import with an undecided anomaly errors and writes nothing", async () => {
    const { db, calls } = fakeDb([]);
    const result = await runTimeImport({ csv: ANOMALY_SHEET, periodId: "pd1", importedBy: "admin-1", db });
    expect(result).toEqual({ error: "undecided_anomalies" });
    // Enforcement runs before any write — no create, no delete, no insert.
    expect(calls.personInsert).toEqual([]);
    expect(calls.sessionInsert).toEqual([]);
    expect(calls.deletes).toEqual([]);
  });

  test("a rejected anomaly skips the session (reported), does not import it", async () => {
    const { db, calls } = fakeDb([]);
    const summary = await runTimeImport({ csv: ANOMALY_SHEET, periodId: "pd1", importedBy: "admin-1", db, decisions: { [FLAG_KEY]: "reject" } });
    if ("error" in summary) throw new Error(summary.error);
    expect(calls.sessionInsert).toEqual([]);
    expect(summary.skipped).toContainEqual({ name: "Flag Person", date: "2026-01-08", reason: "rejected in preview" });
    expect(summary.anomalies.some((a) => a.kind === "over_max_shift")).toBe(true); // still surfaced
  });

  test("an accepted anomaly imports the session normally, still flagged", async () => {
    const { db, calls } = fakeDb([]);
    const summary = await runTimeImport({ csv: ANOMALY_SHEET, periodId: "pd1", importedBy: "admin-1", db, decisions: { [FLAG_KEY]: "accept" } });
    if ("error" in summary) throw new Error(summary.error);
    expect(calls.sessionInsert.length).toBe(1);
    expect(summary.skipped).toEqual([]);
    expect(summary.anomalies.some((a) => a.kind === "over_max_shift")).toBe(true);
  });

  test("dry-run with anomalies needs no decisions (deciding happens in the preview)", async () => {
    const { db } = fakeDb([]);
    const summary = await runTimeImport({ csv: ANOMALY_SHEET, periodId: "pd1", importedBy: "admin-1", db, dryRun: true });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.dryRun).toBe(true);
    expect(summary.anomalies.some((a) => a.kind === "over_max_shift")).toBe(true);
  });
});

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

  test("a merged-away name resolves via alias to the canonical person, not a new create", async () => {
    // "New Person" was merged into "ada" — an alias row maps their old name key
    // to the canonical person. A re-import of that name must match, not create.
    const { db, calls } = fakeDb(
      [{ id: "ada", first_name: "Ada", last_name: "Lovelace", display_name: null, role: "student" }],
      [{ person_id: "ada", name_key: "new|person" }],
    );
    const summary = await runTimeImport({ csv: SHEET, periodId: "pd1", importedBy: "admin-1", db });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.matchedPeople).toBe(2); // Ada (exact) + New Person (alias)
    expect(summary.createdPeople).toBe(0);
    expect(summary.createdNames).toEqual([]);
    expect(calls.personInsert).toEqual([]);
    expect(calls.sessionInsert.some((s) => s.person_id === "ada")).toBe(true);
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
