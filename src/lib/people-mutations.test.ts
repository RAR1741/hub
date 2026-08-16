import { describe, expect, test } from "vitest";
import { createPerson, setPersonEmail, updatePerson, type PersonInput } from "./people";

const input: PersonInput = {
  firstName: "A", lastName: "B", displayName: "AB", role: "student",
  gradYear: 2028, email: "a@b.com", phone: "1", shirtSize: "M",
  dietaryRestrictions: "none", bio: "hi", studentIdNumber: "42", isActive: true,
};

function insertDb(result: { data?: unknown; error?: { code: string } }) {
  return {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => result }) }),
    }),
  } as never;
}
function updateDb(result: { data?: unknown; error?: { code: string } }) {
  return {
    from: () => ({
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => result }) }) }),
    }),
  } as never;
}

describe("createPerson", () => {
  test("409 on unique violation", async () => {
    const r = await createPerson(input, insertDb({ error: { code: "23505" } }));
    expect(r).toEqual({ ok: false, status: 409 });
  });
  test("ok returns id", async () => {
    const r = await createPerson(input, insertDb({ data: { id: "p1" }, error: undefined }));
    expect(r).toEqual({ ok: true, id: "p1" });
  });
});

describe("updatePerson", () => {
  test("404 when no row matched", async () => {
    const r = await updatePerson("missing", input, updateDb({ data: null, error: undefined }));
    expect(r).toEqual({ ok: false, status: 404 });
  });
  test("409 on unique violation", async () => {
    const r = await updatePerson("p1", input, updateDb({ error: { code: "23505" } }));
    expect(r).toEqual({ ok: false, status: 409 });
  });
});

describe("setPersonEmail", () => {
  test("400 on a blank or malformed email (no db call)", async () => {
    const boom = { from: () => { throw new Error("should not query"); } } as never;
    expect(await setPersonEmail("p1", "   ", boom)).toEqual({ ok: false, status: 400 });
    expect(await setPersonEmail("p1", "not-an-email", boom)).toEqual({ ok: false, status: 400 });
  });
  test("lowercases and trims the email before writing", async () => {
    let written: unknown;
    const db = {
      from: () => ({
        update: (patch: unknown) => { written = patch; return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "p1" }, error: undefined }) }) }) }; },
      }),
    } as never;
    const r = await setPersonEmail("p1", "  Ada.Lovelace@Example.COM ", db);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(written).toEqual({ email: "ada.lovelace@example.com" });
  });
  test("409 when the email already belongs to someone else", async () => {
    const r = await setPersonEmail("p1", "taken@example.com", updateDb({ error: { code: "23505" } }));
    expect(r).toEqual({ ok: false, status: 409 });
  });
  test("404 when the person doesn't exist", async () => {
    const r = await setPersonEmail("missing", "a@b.com", updateDb({ data: null, error: undefined }));
    expect(r).toEqual({ ok: false, status: 404 });
  });
});
