import { describe, expect, test } from "vitest";
import {
  canViewProfile,
  deletePerson,
  displayName,
  findPersonForRosterRow,
  listPeople,
  parsePersonInput,
  publicName,
  rosterView,
  updatePersonRosterFields,
} from "./people";
import type { PersonRow } from "./types";
import type { Viewer } from "./viewer";

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: "p1",
  first_name: "Ada",
  last_name: "Lovelace",
  display_name: null,
  role: "student",
  grad_year: 2028,
  email: "ada@example.org",
  is_active: true,
  student_id_number: "1741",
  auth_user_id: null,
  ...over,
});

describe("rosterView", () => {
  const rows = [
    row({ id: "p1", first_name: "Ada", last_name: "Lovelace" }),
    row({ id: "p2", first_name: "Zed", last_name: "Adams", display_name: "Z" }),
    row({ id: "p3", first_name: "Gone", last_name: "Inactive", is_active: false }),
  ];

  test("guest gets alphabetized names of active people only — nothing else", () => {
    const view = rosterView("guest", rows);
    expect(view).toEqual({ kind: "names", names: ["Ada Lovelace", "Z"] });
  });

  test("student also gets names only", () => {
    expect(rosterView("student", rows).kind).toBe("names");
  });

  test("mentor gets full people (active only), ordered by last name", () => {
    const view = rosterView("mentor", rows);
    expect(view.kind).toBe("full");
    if (view.kind === "full") {
      expect(view.people.map((p) => p.id)).toEqual(["p2", "p1"]); // Adams before Lovelace
      expect(view.people[1].email).toBe("ada@example.org"); // full view includes contact fields
    }
  });
});

describe("displayName", () => {
  test("prefers display_name", () => {
    expect(displayName({ first_name: "A", last_name: "B", display_name: "C" })).toBe("C");
  });
  test("falls back to first + last", () => {
    expect(displayName({ first_name: "A", last_name: "B", display_name: null })).toBe("A B");
  });
});

describe("publicName", () => {
  test("first name + last initial", () => {
    expect(publicName({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada L.");
  });
  test("ignores display_name / nicknames (masks the real name)", () => {
    // publicName takes only first/last, so a nickname can never leak a full surname.
    expect(publicName({ first_name: "Zed", last_name: "Adams" })).toBe("Zed A.");
  });
  test("falls back to first name when there is no last name", () => {
    expect(publicName({ first_name: "Cher", last_name: "" })).toBe("Cher");
    expect(publicName({ first_name: "Cher", last_name: "   " })).toBe("Cher");
  });
});

describe("canViewProfile", () => {
  const viewerWith = (role: Viewer["role"], personId: string | null): Viewer =>
    personId
      ? {
          person: {
            id: personId, firstName: "X", lastName: "Y", displayName: null,
            role: role === "guest" ? "student" : (role as never), gradYear: null,
            email: null, isActive: true, studentIdNumber: null, authUserId: null,
            phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
            dateOfBirth: null, streetAddress: null, city: null, zip: null,
            homePhone: null, school: null, ethnicity: null, race: null,
            interests: null, lastApplicationAt: null,
          },
          role,
        }
      : { person: null, role };

  test("self can view", () => {
    expect(canViewProfile(viewerWith("student", "p1"), "p1")).toBe(true);
  });
  test("other student cannot", () => {
    expect(canViewProfile(viewerWith("student", "p2"), "p1")).toBe(false);
  });
  test("mentor can view anyone", () => {
    expect(canViewProfile(viewerWith("mentor", "p9"), "p1")).toBe(true);
  });
  test("guest cannot", () => {
    expect(canViewProfile(viewerWith("guest", null), "p1")).toBe(false);
  });
});

describe("listPeople search-term sanitization", () => {
  test("an injected term cannot restructure the .or() filter", async () => {
    const captured: { or?: string } = {};
    const fakeBuilder = {
      from: () => fakeBuilder,
      select: () => fakeBuilder,
      order: () => fakeBuilder,
      or: (arg: string) => {
        captured.or = arg;
        return fakeBuilder;
      },
      data: [] as PersonRow[],
    };
    // Attempts to close the quoted literal early, inject a fresh top-level
    // `or` clause, and append a raw comma-separated filter of its own.
    const injected = '") or id.eq.whatever,is_active.eq.true--';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listPeople(injected, fakeBuilder as any);

    expect(captured.or).toBeDefined();
    const orClause = captured.or!;

    // Everything the attacker controls must land inside a quoted ilike
    // literal. Strip every quoted segment and what remains must be exactly
    // the fixed three-clause skeleton — no extra `or.`, no stray `)`/`,`
    // reaching the top level of the filter string.
    const skeleton = orClause.replace(/"[^"]*"/g, '""');
    expect(skeleton).toBe(
      'first_name.ilike."",last_name.ilike."",display_name.ilike.""',
    );
  });
});

describe("deletePerson", () => {
  function fakeDb(result: { data: { id: string } | null; error: { code: string } | null }) {
    return {
      from: () => ({
        delete: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => result,
            }),
          }),
        }),
      }),
    } as never;
  }

  test("404 when missing", async () => {
    const result = await deletePerson("p1", fakeDb({ data: null, error: null }));
    expect(result).toEqual({ ok: false, status: 404 });
  });

  test("ok when deleted", async () => {
    const result = await deletePerson("p1", fakeDb({ data: { id: "p1" }, error: null }));
    expect(result).toEqual({ ok: true, status: 200 });
  });

  test("409 when blocked by a restrict FK (e.g. a session they edited)", async () => {
    const result = await deletePerson(
      "p1",
      fakeDb({ data: null, error: { code: "23503" } }),
    );
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("500 on other errors", async () => {
    const result = await deletePerson("p1", fakeDb({ data: null, error: { code: "99999" } }));
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("updatePersonRosterFields", () => {
  function fakeDb(result: { data: { id: string } | null; error: { code: string } | null }) {
    const captured: { update?: Record<string, unknown> } = {};
    const db = {
      from: () => ({
        update: (patch: Record<string, unknown>) => {
          captured.update = patch;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => result,
              }),
            }),
          };
        },
      }),
    } as never;
    return { db, captured };
  }

  const input = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.org",
    role: "student" as const,
    gradYear: 2028,
    studentIdNumber: "1741",
  };

  test("updates only the roster-supplied columns", async () => {
    const { db, captured } = fakeDb({ data: { id: "p1" }, error: null });
    const result = await updatePersonRosterFields("p1", input, db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(captured.update).toEqual({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.org",
      role: "student",
      grad_year: 2028,
      student_id_number: "1741",
    });
    // Fields not in the roster CSV (display_name, phone, shirt_size,
    // dietary_restrictions, bio, is_active) must never be touched.
    expect(captured.update).not.toHaveProperty("display_name");
    expect(captured.update).not.toHaveProperty("is_active");
  });

  test("null email/role/gradYear/studentIdNumber (blank CSV cells) are left out of the patch entirely — never used to clear a column", async () => {
    const { db, captured } = fakeDb({ data: { id: "p1" }, error: null });
    await updatePersonRosterFields(
      "p1",
      { firstName: "Ada", lastName: "Lovelace", email: null, role: null, gradYear: null, studentIdNumber: null },
      db,
    );
    expect(captured.update).toEqual({ first_name: "Ada", last_name: "Lovelace" });
  });

  test("a role that wasn't explicitly specified in the CSV never demotes an existing mentor/admin", async () => {
    const { db, captured } = fakeDb({ data: { id: "p1" }, error: null });
    await updatePersonRosterFields("p1", { ...input, role: null }, db);
    expect(captured.update).not.toHaveProperty("role");
  });

  test("404 when the person no longer exists", async () => {
    const { db } = fakeDb({ data: null, error: null });
    expect(await updatePersonRosterFields("p1", input, db)).toEqual({ ok: false, status: 404 });
  });

  test("409 on unique violation", async () => {
    const { db } = fakeDb({ data: null, error: { code: "23505" } });
    expect(await updatePersonRosterFields("p1", input, db)).toEqual({ ok: false, status: 409 });
  });
});

describe("findPersonForRosterRow", () => {
  test("matches by email first", async () => {
    const calls: string[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: (col: string) => {
            calls.push(col);
            return { maybeSingle: async () => ({ data: { id: "p-email" } }) };
          },
        }),
      }),
    } as never;
    const id = await findPersonForRosterRow({ email: "ada@example.org", studentIdNumber: "1741" }, db);
    expect(id).toBe("p-email");
    expect(calls).toEqual(["email"]); // never even looks up student_id_number
  });

  test("falls back to student_id_number when no email match", async () => {
    let call = 0;
    const db = {
      from: () => ({
        select: () => ({
          eq: () => {
            call += 1;
            const first = call === 1;
            return {
              maybeSingle: async () =>
                first ? { data: null } : { data: { id: "p-sid" } },
            };
          },
        }),
      }),
    } as never;
    const id = await findPersonForRosterRow({ email: "ada@example.org", studentIdNumber: "1741" }, db);
    expect(id).toBe("p-sid");
  });

  test("returns null when neither is present or matches", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        }),
      }),
    } as never;
    expect(await findPersonForRosterRow({ email: null, studentIdNumber: null }, db)).toBeNull();
  });
});

describe("parsePersonInput", () => {
  const valid = {
    firstName: "Ada",
    lastName: "Lovelace",
    role: "student",
    email: "ADA@Example.ORG",
    gradYear: 2028,
    isActive: true,
  };

  test("accepts a valid body and lowercases email", () => {
    const input = parsePersonInput(valid);
    expect(input).not.toBeNull();
    expect(input!.email).toBe("ada@example.org");
    expect(input!.role).toBe("student");
    expect(input!.displayName).toBeNull();
  });

  test.each([
    [{ ...valid, firstName: "" }],
    [{ ...valid, role: "superadmin" }],
    [{ ...valid, gradYear: 1990 }],
    [{ ...valid, email: 42 }],
    [{ ...valid, isActive: "yes" }],
    [null],
  ])("rejects %j", (body) => {
    expect(parsePersonInput(body)).toBeNull();
  });
});
