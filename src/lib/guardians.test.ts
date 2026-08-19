import { describe, expect, test } from "vitest";
import {
  createGuardianForPerson,
  deleteGuardian,
  getGuardiansForPerson,
  linkGuardian,
  parseGuardianInput,
  searchGuardians,
  unlinkGuardian,
  updateGuardian,
} from "./guardians";

describe("parseGuardianInput", () => {
  test("valid input with every field", () => {
    expect(
      parseGuardianInput({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "555-1234",
        employer: "Analytical Engines Inc",
      }),
    ).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "555-1234",
      employer: "Analytical Engines Inc",
    });
  });

  test("missing firstName or lastName -> null", () => {
    expect(parseGuardianInput({ lastName: "Lovelace" })).toBeNull();
    expect(parseGuardianInput({ firstName: "Ada" })).toBeNull();
    expect(parseGuardianInput({ firstName: "", lastName: "Lovelace" })).toBeNull();
  });

  test("overlong strings -> null", () => {
    expect(parseGuardianInput({ firstName: "a".repeat(81), lastName: "Lovelace" })).toBeNull();
    expect(parseGuardianInput({ firstName: "Ada", lastName: "a".repeat(81) })).toBeNull();
    expect(
      parseGuardianInput({ firstName: "Ada", lastName: "Lovelace", email: "a".repeat(255) }),
    ).toBeNull();
    expect(
      parseGuardianInput({ firstName: "Ada", lastName: "Lovelace", phone: "a".repeat(33) }),
    ).toBeNull();
    expect(
      parseGuardianInput({ firstName: "Ada", lastName: "Lovelace", employer: "a".repeat(201) }),
    ).toBeNull();
  });

  test("optional fields absent -> null values ok", () => {
    expect(parseGuardianInput({ firstName: "Ada", lastName: "Lovelace" })).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      email: null,
      phone: null,
      employer: null,
    });
  });
});

describe("getGuardiansForPerson", () => {
  test("maps joined rows and sorts by last name then first name", async () => {
    const db = {
      from: (table: string) => {
        if (table === "person_guardian") {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  {
                    relationship: "Father",
                    guardian: {
                      id: "g2",
                      first_name: "Bob",
                      last_name: "Zephyr",
                      email: null,
                      phone: null,
                      employer: null,
                      last_application_at: null,
                      updated_at: "2026-01-01T00:00:00Z",
                    },
                  },
                  {
                    relationship: "Mother",
                    guardian: {
                      id: "g1",
                      first_name: "Ada",
                      last_name: "Adams",
                      email: "ada@example.com",
                      phone: "555-1234",
                      employer: "Acme",
                      last_application_at: null,
                      updated_at: "2026-01-01T00:00:00Z",
                    },
                  },
                ],
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;

    const result = await getGuardiansForPerson("p1", db);
    expect(result).toEqual([
      {
        relationship: "Mother",
        guardian: {
          id: "g1",
          firstName: "Ada",
          lastName: "Adams",
          email: "ada@example.com",
          phone: "555-1234",
          employer: "Acme",
          lastApplicationAt: null,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
      {
        relationship: "Father",
        guardian: {
          id: "g2",
          firstName: "Bob",
          lastName: "Zephyr",
          email: null,
          phone: null,
          employer: null,
          lastApplicationAt: null,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
    ]);
  });
});

function createGuardianDb(opts: {
  insertResult?: { data?: unknown; error?: { code: string } };
  linkResult?: { error?: { code: string } };
  onLinkInsert?: (patch: unknown) => void;
}) {
  return {
    from: (table: string) => {
      if (table === "guardian") {
        return {
          insert: () => ({
            select: () => ({
              single: async () =>
                opts.insertResult ?? { data: { id: "g1" }, error: undefined },
            }),
          }),
        };
      }
      if (table === "person_guardian") {
        return {
          insert: (patch: unknown) => {
            opts.onLinkInsert?.(patch);
            return Promise.resolve(opts.linkResult ?? { error: undefined });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const guardianInput = { firstName: "Ada", lastName: "Lovelace", email: null, phone: null, employer: null };

describe("createGuardianForPerson", () => {
  test("creates the guardian and links it to the person", async () => {
    let linked: unknown;
    const db = createGuardianDb({ onLinkInsert: (patch) => { linked = patch; } });
    const result = await createGuardianForPerson("p1", guardianInput, "Mother", db);
    expect(result).toEqual({ ok: true, id: "g1" });
    expect(linked).toEqual({ person_id: "p1", guardian_id: "g1", relationship: "Mother" });
  });

  test("foreign-key violation on the link insert -> 404", async () => {
    const db = createGuardianDb({ linkResult: { error: { code: "23503" } } });
    const result = await createGuardianForPerson("missing", guardianInput, null, db);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  test("generic error on either insert -> 500", async () => {
    const guardianInsertFails = createGuardianDb({
      insertResult: { data: undefined, error: { code: "99999" } },
    });
    expect(await createGuardianForPerson("p1", guardianInput, null, guardianInsertFails)).toEqual({
      ok: false,
      status: 500,
    });

    const linkInsertFails = createGuardianDb({ linkResult: { error: { code: "99999" } } });
    expect(await createGuardianForPerson("p1", guardianInput, null, linkInsertFails)).toEqual({
      ok: false,
      status: 500,
    });
  });
});

function linkGuardianDb(result: { error?: { code: string } }, onUpsert?: (patch: unknown, opts: unknown) => void) {
  return {
    from: (table: string) => {
      if (table === "person_guardian") {
        return {
          upsert: (patch: unknown, opts: unknown) => {
            onUpsert?.(patch, opts);
            return Promise.resolve(result);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("linkGuardian", () => {
  test("upserts the join row on success", async () => {
    let upserted: unknown;
    let upsertOpts: unknown;
    const db = linkGuardianDb({ error: undefined }, (patch, opts) => {
      upserted = patch;
      upsertOpts = opts;
    });
    const result = await linkGuardian("p1", "g1", "Mother", db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(upserted).toEqual({ person_id: "p1", guardian_id: "g1", relationship: "Mother" });
    expect(upsertOpts).toEqual({ onConflict: "person_id,guardian_id" });
  });

  test("foreign-key violation -> 404", async () => {
    const db = linkGuardianDb({ error: { code: "23503" } });
    const result = await linkGuardian("missing", "g1", null, db);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  test("other error -> 500", async () => {
    const db = linkGuardianDb({ error: { code: "99999" } });
    const result = await linkGuardian("p1", "g1", null, db);
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

function deleteDb(table: string, result: { data?: unknown; error?: { code: string } }) {
  return {
    from: (t: string) => {
      if (t !== table) throw new Error(`unexpected table ${t}`);
      return {
        delete: () => ({
          eq: () => ({
            eq: () => ({ select: () => ({ maybeSingle: async () => result }) }),
            select: () => ({ maybeSingle: async () => result }),
          }),
        }),
      };
    },
  } as never;
}

describe("unlinkGuardian", () => {
  test("deletes the matching join row", async () => {
    const db = deleteDb("person_guardian", { data: { person_id: "p1" }, error: undefined });
    const result = await unlinkGuardian("p1", "g1", db);
    expect(result).toEqual({ ok: true, status: 200 });
  });

  test("no matching row -> 404", async () => {
    const db = deleteDb("person_guardian", { data: null, error: undefined });
    const result = await unlinkGuardian("p1", "g1", db);
    expect(result).toEqual({ ok: false, status: 404 });
  });
});

function updateGuardianDb(result: { data?: unknown; error?: { code: string } }, onUpdate?: (patch: unknown) => void) {
  return {
    from: (table: string) => {
      if (table !== "guardian") throw new Error(`unexpected table ${table}`);
      return {
        update: (patch: unknown) => {
          onUpdate?.(patch);
          return { eq: () => ({ select: () => ({ maybeSingle: async () => result }) }) };
        },
      };
    },
  } as never;
}

describe("updateGuardian", () => {
  test("updates the guardian row", async () => {
    let written: unknown;
    const db = updateGuardianDb({ data: { id: "g1" }, error: undefined }, (patch) => { written = patch; });
    const result = await updateGuardian("g1", guardianInput, db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(written).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      email: null,
      phone: null,
      employer: null,
    });
    const patch = written as { updated_at: string }; // test-only mock shape, known by construction
    expect(typeof patch.updated_at).toBe("string");
  });

  test("no row -> 404", async () => {
    const db = updateGuardianDb({ data: null, error: undefined });
    const result = await updateGuardian("missing", guardianInput, db);
    expect(result).toEqual({ ok: false, status: 404 });
  });
});

describe("deleteGuardian", () => {
  test("deletes the guardian row", async () => {
    const db = deleteDb("guardian", { data: { id: "g1" }, error: undefined });
    const result = await deleteGuardian("g1", db);
    expect(result).toEqual({ ok: true, status: 200 });
  });

  test("no row -> 404", async () => {
    const db = deleteDb("guardian", { data: null, error: undefined });
    const result = await deleteGuardian("missing", db);
    expect(result).toEqual({ ok: false, status: 404 });
  });
});

describe("searchGuardians", () => {
  test("blank query returns [] without a db call", async () => {
    const boom = { from: () => { throw new Error("should not query"); } } as never;
    expect(await searchGuardians("", boom)).toEqual([]);
    expect(await searchGuardians("   ", boom)).toEqual([]);
  });

  test("non-blank query maps rows", async () => {
    const db = {
      from: (table: string) => {
        if (table !== "guardian") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            or: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: "g1",
                      first_name: "Ada",
                      last_name: "Lovelace",
                      email: null,
                      phone: null,
                      employer: null,
                      last_application_at: null,
                      updated_at: "2026-01-01T00:00:00Z",
                    },
                  ],
                }),
              }),
            }),
          }),
        };
      },
    } as never;
    const result = await searchGuardians("Ada", db);
    expect(result).toEqual([
      {
        id: "g1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: null,
        phone: null,
        employer: null,
        lastApplicationAt: null,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });
});
