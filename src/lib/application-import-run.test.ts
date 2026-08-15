import { describe, expect, test } from "vitest";
import { runApplicationImport } from "./application-import-run";

type PersonSeed = {
  id: string;
  first_name: string;
  last_name: string;
  display_name?: string | null;
  role?: "admin" | "mentor" | "student";
  grad_year?: number | null;
  email?: string | null;
  is_active?: boolean;
  last_application_at?: string | null;
};
type GuardianSeed = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  employer?: string | null;
  last_application_at?: string | null;
};

// Generic chainable fake db. Each `from(table)` call returns a builder that
// records the operation + filters; terminal awaiting resolves { data, error }.
function fakeDb(people: PersonSeed[] = [], guardians: GuardianSeed[] = []) {
  const personRoster = people.map((p) => ({
    role: "student" as const,
    display_name: null,
    grad_year: null,
    email: null,
    is_active: true,
    last_application_at: null,
    date_of_birth: null,
    school: null,
    street_address: null,
    city: null,
    zip: null,
    home_phone: null,
    phone: null,
    shirt_size: null,
    ethnicity: null,
    race: null,
    interests: null,
    dietary_restrictions: null,
    ...p,
  }));
  const guardianRoster = guardians.map((g) => ({
    email: null,
    phone: null,
    employer: null,
    last_application_at: null,
    ...g,
  }));

  const calls = {
    personInsert: [] as Record<string, unknown>[],
    personUpdate: [] as { patch: Record<string, unknown>; filters: Record<string, { op: string; val: unknown }> }[],
    guardianInsert: [] as Record<string, unknown>[],
    guardianUpdate: [] as { patch: Record<string, unknown>; filters: Record<string, { op: string; val: unknown }> }[],
    personGuardianUpsert: [] as Record<string, unknown>[],
    experienceDelete: [] as string[],
    experienceInsert: [] as Record<string, unknown>[],
  };

  let personIdSeq = 0;
  let guardianIdSeq = 0;

  function personBuilder() {
    return {
      select: (_cols: string) => ({ data: personRoster, error: null }),
      insert: (row: Record<string, unknown>) => {
        calls.personInsert.push(row);
        const id = `new-person-${personIdSeq++}`;
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => makeUpdateChain(patch, "person"),
    };
  }

  function guardianBuilder() {
    return {
      select: (_cols: string) => ({ data: guardianRoster, error: null }),
      insert: (row: Record<string, unknown>) => {
        calls.guardianInsert.push(row);
        const id = `new-guardian-${guardianIdSeq++}`;
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => makeUpdateChain(patch, "guardian"),
    };
  }

  function makeUpdateChain(patch: Record<string, unknown>, table: "person" | "guardian") {
    const filters: Record<string, { op: string; val: unknown }> = {};
    const chain: Record<string, unknown> = {
      eq: (col: string, val: unknown) => { filters[col] = { op: "eq", val }; return finish(); },
      lt: (col: string, val: unknown) => { filters[col] = { op: "lt", val }; return finish(); },
      gte: (col: string, val: unknown) => { filters[col] = { op: "gte", val }; return finish(); },
      in: (col: string, vals: unknown[]) => { filters[col] = { op: "in", val: vals }; return finish(); },
      // Mirrors PostgREST .not(col, "in", "(a,b,c)"): keyed distinctly so it
      // doesn't clobber a same-column eq/in filter.
      not: (col: string, op: string, val: unknown) => { filters[`not:${col}:${op}`] = { op: `not_${op}`, val }; return finish(); },
    };
    function finish(): Record<string, unknown> {
      const record = () => {
        if (table === "person") calls.personUpdate.push({ patch, filters: { ...filters } });
        else calls.guardianUpdate.push({ patch, filters: { ...filters } });
      };
      const matched = () => {
        const roster = table === "person" ? personRoster : guardianRoster;
        return roster.filter((row) => {
          return Object.entries(filters).every(([key, f]) => {
            const fv = f as { op: string; val: unknown };
            // not-filters are keyed `not:<col>:<op>`; plain ones by column.
            const col = key.startsWith("not:") ? key.split(":")[1] : key;
            const rowVal = (row as Record<string, unknown>)[col];
            if (fv.op === "eq") return rowVal === fv.val;
            if (fv.op === "lt") return (rowVal as number) !== null && (rowVal as number) < (fv.val as number);
            if (fv.op === "gte") return (rowVal as number) !== null && (rowVal as number) >= (fv.val as number);
            if (fv.op === "in") return (fv.val as unknown[]).includes(rowVal);
            if (fv.op === "not_in") {
              // val is a PostgREST list literal: "(id1,id2,...)".
              const ids = String(fv.val).replace(/^\(|\)$/g, "").split(",").filter(Boolean);
              return !ids.includes(String(rowVal));
            }
            return true;
          });
        });
      };
      return {
        eq: chain.eq, lt: chain.lt, gte: chain.gte, in: chain.in, not: chain.not,
        select: (_cols: string) => {
          record();
          const rows = matched().map((r: Record<string, unknown>) => ({ id: r.id }));
          return Promise.resolve({ data: rows, error: null });
        },
        then: (resolve: (v: { error: null }) => void) => {
          record();
          resolve({ error: null });
        },
      } as unknown as Record<string, unknown>;
    }
    return finish();
  }

  const db = {
    from(table: string) {
      if (table === "person") return personBuilder();
      if (table === "guardian") return guardianBuilder();
      if (table === "person_guardian") {
        return {
          upsert: async (row: Record<string, unknown>, _opts: unknown) => {
            calls.personGuardianUpsert.push(row);
            return { error: null };
          },
        };
      }
      if (table === "first_experience") {
        return {
          delete: () => ({ eq: async (_col: string, val: string) => { calls.experienceDelete.push(val); return { error: null }; } }),
          insert: async (rows: Record<string, unknown>[]) => { calls.experienceInsert.push(...rows); return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;

  return { db, calls };
}

function csvFor(rows: string[][], headerExtra: string[] = []): string {
  const header = [
    "Timestamp", "First Name", "Preferred Name", "Last Name", "Date of Birth", "Graduation Year",
    "What school are you attending 2026-2027", "Street Address", "City", "Zip Code", "Home Phone Number",
    "Cell Phone Number", "Email Address", "T-Shirt Size", "What is your ethnicity", "What is your race",
    "Items of interest", "Parent/Guardian 1 First Name", "Parent/Guardian 1 Last Name",
    "Parent/Guardian 1 Relationship", "Parent/Guardian 1 Cell Phone", "Parent/Guardian 1 Email",
    "Parent/Guardian 1 Employment", "Parent/Guardian 2 (if applicable)", "Parent/Guardian 2",
    "Parent/Guardian 2 Relationship", "Parent/Guardian 2 Cell Phone", "Parent/Guardian 2 Email",
    "Parent/Guardian 2 Employment",
    "Have you participated as a student in FLL Explore/Jr?", "Have you participated as a student in FLL?",
    "Have you participated as a student in FTC?", "Have you participated as a student in FRC?",
    ...headerExtra,
  ];
  const lines = [header.join(","), ...rows.map((r) => r.join(","))];
  return lines.join("\n");
}

function row(overrides: Partial<Record<string, string>>): string[] {
  const defaults: Record<string, string> = {
    timestamp: "1/8/2026 10:00:00",
    first: "Grace", preferred: "", last: "Hopper", dob: "1/1/2010", gradYear: "2028",
    school: "Test High", street: "123 Test St", city: "Testville", zip: "46000",
    homePhone: "", cell: "555-0100", email: "grace@example.com", shirt: "M",
    ethnicity: "N/A", race: "N/A", interests: "", g1First: "", g1Last: "", g1Rel: "", g1Phone: "", g1Email: "", g1Employer: "",
    g2First: "", g2Last: "", g2Rel: "", g2Phone: "", g2Email: "", g2Employer: "",
    fllExplore: "", fllChallenge: "", ftc: "", frc: "",
  };
  const v = { ...defaults, ...overrides } as Record<string, string>;
  return [
    v.timestamp, v.first, v.preferred, v.last, v.dob, v.gradYear, v.school, v.street, v.city, v.zip,
    v.homePhone, v.cell, v.email, v.shirt, v.ethnicity, v.race, v.interests,
    v.g1First, v.g1Last, v.g1Rel, v.g1Phone, v.g1Email, v.g1Employer,
    v.g2First, v.g2Last, v.g2Rel, v.g2Phone, v.g2Email, v.g2Employer,
    v.fllExplore, v.fllChallenge, v.ftc, v.frc,
  ].map((c) => (c.includes(",") ? `"${c}"` : c));
}

const NOW_AUG = () => new Date("2026-08-14T00:00:00Z"); // month 7 -> season 2027

describe("runApplicationImport matching", () => {
  test("auto-matches by name and applies latest-wins field changes", async () => {
    const { db, calls } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper", email: "old@example.com", grad_year: 2028 }]);
    const csv = csvFor([row({})]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.matched.map((m) => m.personId)).toEqual(["p1"]);
    expect(calls.personUpdate[0].patch.email).toBe("grace@example.com");
    expect(calls.personUpdate[0].filters.id).toEqual({ op: "eq", val: "p1" });
  });

  test("auto-matches by email when name differs slightly", async () => {
    const { db } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper", email: "grace@example.com" }]);
    const csv = csvFor([row({})]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.matched.map((m) => m.personId)).toEqual(["p1"]);
  });

  test("ambiguous exact match (two candidates) needs a decision", async () => {
    const { db, calls } = fakeDb([
      { id: "p1", first_name: "Grace", last_name: "Hopper", email: "a@example.com" },
      { id: "p2", first_name: "Grace", last_name: "Hopper", email: "b@example.com" },
    ]);
    const csv = csvFor([row({ email: "different@example.com" })]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: true, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.needsDecision.length).toBe(1);
    expect(summary.needsDecision[0].candidates.map((c) => c.personId).sort()).toEqual(["p1", "p2"]);
    expect(calls.personUpdate).toEqual([]);
  });

  test("fuzzy match (same last name, prefix first name) needs decision; link/create/skip honored on confirm", async () => {
    const seed = [{ id: "p1", first_name: "Gracelyn", last_name: "Hopper", email: "existing@example.com" }];
    const csv = csvFor([row({ first: "Grace", email: "new@example.com" })]);
    const key = "grace|hopper|2010-01-01";

    const dry = fakeDb(seed);
    const preview = await runApplicationImport({ csvText: csv, dryRun: true, db: dry.db, now: NOW_AUG });
    if ("error" in preview) throw new Error(preview.error);
    expect(preview.needsDecision.length).toBe(1);
    expect(preview.needsDecision[0].key).toBe(key);

    const linkRun = fakeDb(seed);
    const linked = await runApplicationImport({
      csvText: csv, dryRun: false, confirm: true, db: linkRun.db, now: NOW_AUG,
      decisions: { [key]: "link:p1" },
    });
    if ("error" in linked) throw new Error(linked.error);
    expect(linked.matched.map((m) => m.personId)).toEqual(["p1"]);

    const createRun = fakeDb(seed);
    const created = await runApplicationImport({
      csvText: csv, dryRun: false, confirm: true, db: createRun.db, now: NOW_AUG,
      decisions: { [key]: "create" },
    });
    if ("error" in created) throw new Error(created.error);
    expect(created.created).toEqual(["Grace Hopper"]);

    const skipRun = fakeDb(seed);
    const skipped = await runApplicationImport({
      csvText: csv, dryRun: false, confirm: true, db: skipRun.db, now: NOW_AUG,
      decisions: { [key]: "skip" },
    });
    if ("error" in skipped) throw new Error(skipped.error);
    expect(skipped.skipped).toEqual([{ name: "Grace Hopper", reason: "decision=skip" }]);
  });

  test("undecided decisions block all writes on confirm", async () => {
    const seed = [{ id: "p1", first_name: "Gracelyn", last_name: "Hopper" }];
    const csv = csvFor([row({ first: "Grace" })]);
    const { db, calls } = fakeDb(seed);
    const result = await runApplicationImport({ csvText: csv, dryRun: false, confirm: true, db, now: NOW_AUG });
    expect(result).toEqual({ error: "undecided_decisions" });
    expect(calls.personInsert).toEqual([]);
    expect(calls.personUpdate).toEqual([]);
  });
});

describe("runApplicationImport latest-wins staleness", () => {
  test("skips as stale when person.last_application_at >= response timestamp", async () => {
    const { db, calls } = fakeDb([
      { id: "p1", first_name: "Grace", last_name: "Hopper", last_application_at: "2026-09-01T00:00:00.000Z" },
    ]);
    const csv = csvFor([row({ timestamp: "8/1/2026 10:00:00" })]); // Aug 1 < Sep 1
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.stale).toEqual([{ name: "Grace Hopper" }]);
    // The deactivation sweep still runs, but nothing targets this specific person.
    expect(calls.personUpdate.every((u) => u.filters.id?.val !== "p1")).toBe(true);
  });

  test("applies update when response is newer than last_application_at", async () => {
    const { db, calls } = fakeDb([
      { id: "p1", first_name: "Grace", last_name: "Hopper", last_application_at: "2026-01-01T00:00:00.000Z" },
    ]);
    const csv = csvFor([row({ timestamp: "8/1/2026 10:00:00" })]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.stale).toEqual([]);
    expect(summary.matched.map((m) => m.personId)).toEqual(["p1"]);
    expect(calls.personUpdate.some((u) => u.filters.id?.val === "p1" && u.patch.email === "grace@example.com")).toBe(true);
  });
});

describe("runApplicationImport never overwrites data with blanks", () => {
  test("a blank incoming email does not overwrite an existing email", async () => {
    const { db, calls } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper", email: "keep@example.com" }]);
    const summary = await runApplicationImport({ csvText: csvFor([row({ email: "" })]), dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.matched.map((m) => m.personId)).toEqual(["p1"]);
    expect("email" in calls.personUpdate[0].patch).toBe(false);
    expect(summary.matched[0].changes.find((c) => c.field === "email")).toBeUndefined();
  });

  test("a form with no preferred name does not clear an admin-set display_name", async () => {
    const { db, calls } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper", display_name: "Amazing Grace" }]);
    const summary = await runApplicationImport({ csvText: csvFor([row({ preferred: "" })]), dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect("display_name" in calls.personUpdate[0].patch).toBe(false);
    expect(summary.matched[0].changes.find((c) => c.field === "display_name")).toBeUndefined();
  });

  test("blank interests are omitted from the patch", async () => {
    const { db, calls } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper" }]);
    await runApplicationImport({ csvText: csvFor([row({ interests: "" })]), dryRun: false, db, now: NOW_AUG });
    expect("interests" in calls.personUpdate[0].patch).toBe(false);
  });

  test("a non-blank incoming value still overwrites (latest-wins preserved)", async () => {
    const { db, calls } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper", email: "old@example.com" }]);
    const summary = await runApplicationImport({ csvText: csvFor([row({ email: "new@example.com" })]), dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(calls.personUpdate[0].patch.email).toBe("new@example.com");
    expect(summary.matched[0].changes).toContainEqual({ field: "email", from: "old@example.com", to: "new@example.com" });
  });
});

describe("runApplicationImport experiences", () => {
  test("replace-wholesale: deletes then inserts the parsed experience set", async () => {
    const { db, calls } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper" }]);
    const csv = csvFor([row({ frc: "2025 Rapid React" })]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(calls.experienceDelete).toEqual(["p1"]);
    expect(calls.experienceInsert).toEqual([{ person_id: "p1", level: "frc", year: 2025, name: "Rapid React" }]);
    expect(summary.experienceRows).toBe(1);
  });
});

describe("runApplicationImport guardians", () => {
  test("two siblings on separate imports link to the same guardian row", async () => {
    const guardianSeed = [{ id: "g1", first_name: "Pat", last_name: "Hopper", email: "pat@example.com" }];
    const { db, calls } = fakeDb(
      [
        { id: "p1", first_name: "Grace", last_name: "Hopper" },
        { id: "p2", first_name: "Gray", last_name: "Hopper" },
      ],
      guardianSeed,
    );
    const csv = csvFor([
      row({ first: "Grace", email: "grace@example.com", g1First: "Pat", g1Last: "Hopper", g1Email: "pat@example.com", g1Rel: "Mother" }),
      row({ first: "Gray", email: "gray@example.com", g1First: "Pat", g1Last: "Hopper", g1Email: "pat@example.com", g1Rel: "Mother" }),
    ]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.guardiansCreated).toBe(0);
    expect(summary.guardiansMatched).toBe(2);
    expect(calls.guardianInsert).toEqual([]);
    expect(calls.personGuardianUpsert.every((r) => r.guardian_id === "g1")).toBe(true);
    expect(calls.personGuardianUpsert.map((r) => r.person_id).sort()).toEqual(["p1", "p2"]);
  });

  test("guardian contact fields update when this response is newer", async () => {
    const guardianSeed = [{ id: "g1", first_name: "Pat", last_name: "Hopper", email: "old@example.com", last_application_at: "2025-01-01T00:00:00.000Z" }];
    const { db, calls } = fakeDb([{ id: "p1", first_name: "Grace", last_name: "Hopper" }], guardianSeed);
    const csv = csvFor([row({ g1First: "Pat", g1Last: "Hopper", g1Email: "old@example.com", g1Employer: "New Employer" })]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(summary.guardiansMatched).toBe(1);
    expect(calls.guardianUpdate.length).toBe(1);
    expect(calls.guardianUpdate[0].patch.employer).toBe("New Employer");
  });
});

describe("runApplicationImport roster sweep (current-season membership)", () => {
  // The generated CSV header ("...2026-2027 School Year") parses to season 2027,
  // which matches currentSeasonYear(NOW_AUG) — so these imports are the current
  // season and DO re-derive the active roster.
  test("current-season import deactivates active students NOT in the application", async () => {
    const { db, calls } = fakeDb([
      // A returning student (matched by this import) — should stay active.
      { id: "p1", first_name: "Grace", last_name: "Hopper", role: "student", email: "grace@example.com", is_active: true },
      // An active student who did NOT re-apply — should be deactivated.
      { id: "p2", first_name: "Gone", last_name: "Missing", role: "student", is_active: true },
    ]);
    const csv = csvFor([row({})]); // Grace Hopper only
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);

    // Deactivation targets active students, excluding the written set.
    const deactivate = calls.personUpdate.find((u) => u.patch.is_active === false);
    expect(deactivate).toBeDefined();
    expect(deactivate!.filters["role"]?.val).toBe("student");
    expect(deactivate!.filters["is_active"]?.val).toBe(true);
    expect(deactivate!.filters["not:id:in"]?.val).toContain("p1");
    expect(summary.deactivated).toBe(1); // only p2 (p1 excluded as written)
  });

  test("an OLD/historical import never deactivates current students", async () => {
    const { db, calls } = fakeDb([
      { id: "p1", first_name: "Grace", last_name: "Hopper", role: "student", is_active: true },
    ]);
    // The school-column header carries the season ("...2026-2027"); rewrite it
    // to an old range so this parses as a historical (non-current) import.
    const csv = csvFor([row({})]).replace("2026-2027", "2019-2020");
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(calls.personUpdate.some((u) => u.patch.is_active === false)).toBe(false);
    expect(summary.deactivated).toBe(0);
  });

  test("new applicants from the current-season import are created active", async () => {
    const { db, calls } = fakeDb([]);
    const csv = csvFor([row({ first: "New", last: "Student", email: "new@example.com" })]);
    const summary = await runApplicationImport({ csvText: csv, dryRun: false, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    expect(calls.personInsert[0].is_active).toBe(true);
  });

  test("dry-run projects wouldDeactivate for the current season without writing", async () => {
    const { db, calls } = fakeDb([
      { id: "p1", first_name: "Grace", last_name: "Hopper", role: "student", email: "grace@example.com", is_active: true },
      { id: "p2", first_name: "Gone", last_name: "Missing", role: "student", is_active: true },
      { id: "p3", first_name: "Already", last_name: "Inactive", role: "student", is_active: false },
    ]);
    const csv = csvFor([row({})]); // matches p1 only
    const summary = await runApplicationImport({ csvText: csv, dryRun: true, db, now: NOW_AUG });
    if ("error" in summary) throw new Error(summary.error);
    // p2 is active and not in the import; p1 is written (kept); p3 already inactive.
    expect(summary.wouldDeactivate).toBe(1);
    expect(summary.deactivated).toBe(0);
    expect(calls.personUpdate).toEqual([]);
    expect(calls.personInsert).toEqual([]);
  });
});
