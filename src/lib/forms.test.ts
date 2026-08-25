import { describe, expect, test } from "vitest";
import { createForm, getFormWithFields, parseFieldInput, parseFormInput, validateAnswers, type FieldWithOptions } from "./forms";

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
  type: "boolean", required: false, position: 1, semanticKey: null, options: [],
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

  test("dedupes repeated multi_select values", () => {
    const r = validateAnswers([comps], [{ fieldId: "f_c", values: ["columbus", "columbus"] }]);
    expect(r).toEqual({ ok: true, answers: [{ field_id: "f_c", value: "columbus" }] });
  });
});

describe("parseFormInput", () => {
  test("valid", () => {
    expect(parseFormInput({ title: "Outreach", kind: "event_signup", status: "draft" }))
      .toEqual({ title: "Outreach", description: null, kind: "event_signup", status: "draft", notesEnabled: false, notesLabel: null });
  });
  test("carries the notes field config through", () => {
    expect(parseFormInput({ title: "Outreach", kind: "event_signup", status: "draft", notesEnabled: true, notesLabel: "Dietary needs?" }))
      .toEqual({ title: "Outreach", description: null, kind: "event_signup", status: "draft", notesEnabled: true, notesLabel: "Dietary needs?" });
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
  test("rejects unknown type", () => {
    expect(parseFieldInput({ label: "Q", type: "date", required: false, position: 0 })).toBeNull();
  });
  test("ignores any semanticKey in the request — mentor fields never carry one", () => {
    expect(parseFieldInput({ label: "Q", type: "short_text", required: false, position: 0, semanticKey: "attending" }))
      .toEqual({ label: "Q", helpText: null, type: "short_text", required: false, position: 0, semanticKey: null, options: [] });
  });
});

describe("createForm", () => {
  // createForm inserts the form, then auto-adds the attendance field (a
  // form_field + its form_field_option rows), then optionally a notes field.
  function fakeDb(insertError?: { code: string }) {
    const inserts: Record<string, number> = {};
    const db = {
      from(table: string) {
        inserts[table] = (inserts[table] ?? 0) + 1;
        if (table === "form") return {
          insert: () => ({ select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "form1" }, error: null }) }) }),
        };
        if (table === "form_field") return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: `field${inserts[table]}` }, error: null }) }) }),
        };
        if (table === "form_field_option") return { insert: async () => ({ error: null }) };
        throw new Error(`unexpected table ${table}`);
      },
      inserts,
    };
    return db as never;
  }
  test("201 returns new id and auto-adds the attendance field", async () => {
    const db = fakeDb();
    expect(await createForm({ title: "Outreach", description: null, kind: "event_signup", status: "draft", notesEnabled: false, notesLabel: null }, "m1", db))
      .toEqual({ ok: true, id: "form1" });
    // one attendance field, with its options; no notes field
    expect((db as unknown as { inserts: Record<string, number> }).inserts.form_field).toBe(1);
    expect((db as unknown as { inserts: Record<string, number> }).inserts.form_field_option).toBe(1);
  });
  test("adds a notes field when enabled", async () => {
    const db = fakeDb();
    await createForm({ title: "Outreach", description: null, kind: "event_signup", status: "draft", notesEnabled: true, notesLabel: "Notes" }, "m1", db);
    // attendance + notes
    expect((db as unknown as { inserts: Record<string, number> }).inserts.form_field).toBe(2);
  });
  test("maps FK violation to 400", async () => {
    expect(await createForm({ title: "x", description: null, kind: "event_signup", status: "draft", notesEnabled: false, notesLabel: null }, "m1", fakeDb({ code: "23503" })))
      .toEqual({ ok: false, status: 400 });
  });
});

describe("getFormWithFields", () => {
  function fakeDb() {
    return {
      from(table: string) {
        if (table === "form") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: "form1", title: "Outreach", description: null, kind: "event_signup", status: "published", created_by: "m1", created_at: "2020-01-01T00:00:00Z" },
        }) }) }) };
        if (table === "form_field") return { select: () => ({ eq: () => ({ order: async () => ({
          data: [{ id: "f1", form_id: "form1", label: "Attending?", help_text: null, type: "single_select", required: true, position: 0, semantic_key: "attending" }],
        }) }) }) };
        if (table === "form_field_option") return { select: () => ({ in: () => ({ order: async () => ({
          data: [{ id: "o1", field_id: "f1", value: "yes", label: "Yes", position: 0 }],
        }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }
  test("assembles form + fields + options", async () => {
    const r = await getFormWithFields("form1", fakeDb());
    expect(r?.form.title).toBe("Outreach");
    expect(r?.fields[0].options[0].value).toBe("yes");
  });

  test("returns null when the form_field read errors", async () => {
    const errDb = {
      from(table: string) {
        if (table === "form") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: "form1", title: "Outreach", description: null, kind: "event_signup", status: "published", created_by: "m1", created_at: "2020-01-01T00:00:00Z" },
          error: null,
        }) }) }) };
        if (table === "form_field") return { select: () => ({ eq: () => ({ order: async () => ({
          data: null, error: { code: "500" },
        }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
    expect(await getFormWithFields("form1", errDb)).toBeNull();
  });
});
