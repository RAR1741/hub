import { describe, expect, test } from "vitest";
import { createPerson, updatePerson, type PersonInput } from "./people";

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
  test("409 email_has_secondaries when the mirror trigger blocks blanking", async () => {
    const r = await updatePerson("p1", input, updateDb({ error: { code: "P0001" } }));
    expect(r).toEqual({ ok: false, status: 409, reason: "email_has_secondaries" });
  });
});
