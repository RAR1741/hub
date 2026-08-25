import { describe, expect, test } from "vitest";
import { parseFieldInput, parseFormInput, validateAnswers, type FieldWithOptions } from "./forms";

const attending: FieldWithOptions = {
  id: "f_att", formId: "form1", label: "Attending?", helpText: null,
  type: "single_select", required: true, position: 0, semanticKey: "attending",
  options: [
    { id: "o1", fieldId: "f_att", value: "yes", label: "Yes", position: 0 },
    { id: "o2", fieldId: "f_att", value: "no", label: "No", position: 1 },
  ],
};
const transport: FieldWithOptions = {
  id: "f_tr", formId: "form1", label: "Can transport?", helpText: null,
  type: "boolean", required: false, position: 1, semanticKey: "can_transport", options: [],
};
const comps: FieldWithOptions = {
  id: "f_c", formId: "form1", label: "Which comps?", helpText: null,
  type: "multi_select", required: false, position: 2, semanticKey: null,
  options: [
    { id: "c1", fieldId: "f_c", value: "columbus", label: "Columbus", position: 0 },
    { id: "c2", fieldId: "f_c", value: "state", label: "State", position: 1 },
  ],
};

describe("validateAnswers", () => {
  test("accepts a valid submission and flattens multi_select", () => {
    const r = validateAnswers([attending, transport, comps], [
      { fieldId: "f_att", values: ["yes"] },
      { fieldId: "f_tr", values: ["true"] },
      { fieldId: "f_c", values: ["columbus", "state"] },
    ]);
    expect(r).toEqual({
      ok: true,
      answers: [
        { field_id: "f_att", value: "yes" },
        { field_id: "f_tr", value: "true" },
        { field_id: "f_c", value: "columbus" },
        { field_id: "f_c", value: "state" },
      ],
    });
  });

  test("rejects when a required field is missing", () => {
    expect(validateAnswers([attending], [])).toEqual({ ok: false });
  });

  test("rejects an option value not on the field", () => {
    expect(validateAnswers([attending], [{ fieldId: "f_att", values: ["maybe"] }])).toEqual({ ok: false });
  });

  test("rejects a non-boolean value for a boolean field", () => {
    expect(validateAnswers([transport], [{ fieldId: "f_tr", values: ["yes"] }])).toEqual({ ok: false });
  });

  test("rejects multiple values for a single_select", () => {
    expect(validateAnswers([attending], [{ fieldId: "f_att", values: ["yes", "no"] }])).toEqual({ ok: false });
  });

  test("rejects an answer referencing an unknown field", () => {
    expect(validateAnswers([attending], [
      { fieldId: "f_att", values: ["yes"] },
      { fieldId: "ghost", values: ["x"] },
    ])).toEqual({ ok: false });
  });
});

describe("parseFormInput", () => {
  test("valid", () => {
    expect(parseFormInput({ title: "Outreach", kind: "event_signup", status: "draft" }))
      .toEqual({ title: "Outreach", description: null, kind: "event_signup", status: "draft" });
  });
  test("rejects unknown kind/status", () => {
    expect(parseFormInput({ title: "x", kind: "quiz", status: "draft" })).toBeNull();
    expect(parseFormInput({ title: "x", kind: "event_signup", status: "live" })).toBeNull();
  });
  test("rejects missing title", () => {
    expect(parseFormInput({ kind: "event_signup", status: "draft" })).toBeNull();
  });
});

describe("parseFieldInput", () => {
  test("select field requires >=1 option", () => {
    expect(parseFieldInput({ label: "Q", type: "single_select", required: true, position: 0, options: [] })).toBeNull();
  });
  test("boolean field ignores options", () => {
    expect(parseFieldInput({ label: "Q", type: "boolean", required: false, position: 1 }))
      .toEqual({ label: "Q", helpText: null, type: "boolean", required: false, position: 1, semanticKey: null, options: [] });
  });
  test("rejects unknown type and unknown semantic key", () => {
    expect(parseFieldInput({ label: "Q", type: "date", required: false, position: 0 })).toBeNull();
    expect(parseFieldInput({ label: "Q", type: "short_text", required: false, position: 0, semanticKey: "bogus" })).toBeNull();
  });
});
