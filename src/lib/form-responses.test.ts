import { describe, expect, test } from "vitest";
import { submitEventSignupResponse } from "./form-responses";

const FORM = {
  form: { id: "form1", title: "Outreach", description: null, kind: "event_signup", status: "published", createdBy: "m1", createdAt: "2020-01-01T00:00:00Z" },
  fields: [{
    id: "f_att", formId: "form1", label: "Attending?", helpText: null, type: "single_select" as const,
    required: true, position: 0, semanticKey: "attending" as const,
    options: [{ id: "o1", fieldId: "f_att", value: "yes", label: "Yes", position: 0 }],
  }],
};

function fakeDb(opts: { rpcError?: { code: string } } = {}) {
  return {
    // getFormWithFields is injected via the form arg in tests; here we stub rpc only.
    rpc: async () => (opts.rpcError ? { data: null, error: opts.rpcError } : { data: "resp1", error: null }),
  } as never;
}

describe("submitEventSignupResponse", () => {
  test("201 on a valid submission", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1",
      [{ fieldId: "f_att", values: ["yes"] }], fakeDb(), FORM);
    expect(r).toEqual({ ok: true, status: 201 });
  });
  test("400 when answers fail validation (missing required)", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1", [], fakeDb(), FORM);
    expect(r).toEqual({ ok: false, status: 400 });
  });
  test("409 when already signed up (unique violation from rpc)", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1",
      [{ fieldId: "f_att", values: ["yes"] }], fakeDb({ rpcError: { code: "23505" } }), FORM);
    expect(r).toEqual({ ok: false, status: 409 });
  });
  test("409 when the event is not open (P0100 from rpc)", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1",
      [{ fieldId: "f_att", values: ["yes"] }], fakeDb({ rpcError: { code: "P0100" } }), FORM);
    expect(r).toEqual({ ok: false, status: 409 });
  });
});
