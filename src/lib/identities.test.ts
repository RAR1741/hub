import { describe, expect, test } from "vitest";
import { addPersonEmail, makePrimaryIdentity, removePersonIdentity } from "./identities";

function personDb(person: { data?: unknown; error?: { code: string } }) {
  return {
    from: (table: string) => {
      if (table === "person") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => person }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function addEmailDb(opts: {
  person: { data?: unknown; error?: { code: string } };
  updateResult?: { error?: { code: string } };
  insertResult?: { error?: { code: string } };
  onUpdate?: (patch: unknown) => void;
  onInsert?: (patch: unknown) => void;
}) {
  return {
    from: (table: string) => {
      if (table === "person") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => opts.person }) }),
          update: (patch: unknown) => {
            opts.onUpdate?.(patch);
            return { eq: async () => opts.updateResult ?? { error: undefined } };
          },
        };
      }
      if (table === "person_identity") {
        return {
          insert: (patch: unknown) => {
            opts.onInsert?.(patch);
            return Promise.resolve(opts.insertResult ?? { error: undefined });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function identityDb(opts: {
  identity: { data?: unknown; error?: { code: string } };
  count?: number;
  onUpdate?: (patch: unknown) => void;
  onDelete?: () => void;
}) {
  return {
    from: (table: string) => {
      if (table === "person_identity") {
        return {
          select: (cols?: string, sel?: { count?: string; head?: boolean }) => {
            if (sel?.count) {
              return {
                eq: () => ({
                  eq: async () => ({ count: opts.count ?? 0 }),
                }),
              };
            }
            return {
              eq: () => ({ eq: () => ({ maybeSingle: async () => opts.identity }) }),
            };
          },
          delete: () => {
            opts.onDelete?.();
            return { eq: async () => ({ error: undefined }) };
          },
        };
      }
      if (table === "person") {
        return {
          update: (patch: unknown) => {
            opts.onUpdate?.(patch);
            return { eq: async () => ({ error: undefined }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("addPersonEmail", () => {
  test("400 on blank or malformed email (no db call)", async () => {
    const boom = { from: () => { throw new Error("should not query"); } } as never;
    expect(await addPersonEmail("p1", "   ", boom)).toEqual({ ok: false, status: 400 });
    expect(await addPersonEmail("p1", "not-an-email", boom)).toEqual({ ok: false, status: 400 });
  });

  test("first email goes through person.email (becomes primary)", async () => {
    let written: unknown;
    const db = addEmailDb({
      person: { data: { id: "p1", email: null }, error: undefined },
      onUpdate: (patch) => { written = patch; },
    });
    const r = await addPersonEmail("p1", "a@b.com", db);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(written).toEqual({ email: "a@b.com" });
  });

  test("later email inserts a secondary identity", async () => {
    let inserted: unknown;
    const db = addEmailDb({
      person: { data: { id: "p1", email: "existing@b.com" }, error: undefined },
      onInsert: (patch) => { inserted = patch; },
    });
    const r = await addPersonEmail("p1", "second@b.com", db);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(inserted).toEqual({ person_id: "p1", email: "second@b.com", is_primary: false });
  });

  test("lowercases and trims", async () => {
    let written: unknown;
    const db = addEmailDb({
      person: { data: { id: "p1", email: null }, error: undefined },
      onUpdate: (patch) => { written = patch; },
    });
    const r = await addPersonEmail("p1", "  Ada.Lovelace@Example.COM ", db);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(written).toEqual({ email: "ada.lovelace@example.com" });
  });

  test("409 when the email belongs to someone else", async () => {
    const db = addEmailDb({
      person: { data: { id: "p1", email: "existing@b.com" }, error: undefined },
      insertResult: { error: { code: "23505" } },
    });
    const r = await addPersonEmail("p1", "taken@b.com", db);
    expect(r).toEqual({ ok: false, status: 409 });
  });

  test("404 when the person doesn't exist", async () => {
    const db = personDb({ data: null, error: undefined });
    const r = await addPersonEmail("missing", "a@b.com", db);
    expect(r).toEqual({ ok: false, status: 404 });
  });
});

describe("removePersonIdentity", () => {
  test("404 when identity missing or belongs to another person", async () => {
    const db = identityDb({ identity: { data: null, error: undefined } });
    const r = await removePersonIdentity("p1", "i1", db);
    expect(r).toEqual({ ok: false, status: 404 });
  });

  test("deletes a secondary directly", async () => {
    let deleted = false;
    const db = identityDb({
      identity: { data: { id: "i1", person_id: "p1", email: "b@b.com", is_primary: false }, error: undefined },
      onDelete: () => { deleted = true; },
    });
    const r = await removePersonIdentity("p1", "i1", db);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(deleted).toBe(true);
  });

  test("409 primary_with_secondaries when primary and others exist", async () => {
    const db = identityDb({
      identity: { data: { id: "i1", person_id: "p1", email: "a@b.com", is_primary: true }, error: undefined },
      count: 1,
    });
    const r = await removePersonIdentity("p1", "i1", db);
    expect(r).toEqual({ ok: false, status: 409, reason: "primary_with_secondaries" });
  });

  test("sole primary blanks person.email instead of direct delete", async () => {
    let written: unknown;
    const db = identityDb({
      identity: { data: { id: "i1", person_id: "p1", email: "a@b.com", is_primary: true }, error: undefined },
      count: 0,
      onUpdate: (patch) => { written = patch; },
    });
    const r = await removePersonIdentity("p1", "i1", db);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(written).toEqual({ email: null });
  });
});

describe("makePrimaryIdentity", () => {
  test("404 when identity missing", async () => {
    const db = identityDb({ identity: { data: null, error: undefined } });
    const r = await makePrimaryIdentity("p1", "i1", db);
    expect(r).toEqual({ ok: false, status: 404 });
  });

  test("200 no-op when already primary", async () => {
    const db = identityDb({
      identity: { data: { id: "i1", person_id: "p1", email: "a@b.com", is_primary: true }, error: undefined },
    });
    const r = await makePrimaryIdentity("p1", "i1", db);
    expect(r).toEqual({ ok: true, status: 200 });
  });

  test("sets person.email to the identity email", async () => {
    let written: unknown;
    const db = identityDb({
      identity: { data: { id: "i1", person_id: "p1", email: "second@b.com", is_primary: false }, error: undefined },
      onUpdate: (patch) => { written = patch; },
    });
    const r = await makePrimaryIdentity("p1", "i1", db);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(written).toEqual({ email: "second@b.com" });
  });
});
