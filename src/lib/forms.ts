import type { FormField, FormFieldOption, FormFieldType, SemanticKey } from "./types";
import { optInt, optString, reqString } from "./validate";

export type FieldWithOptions = FormField & { options: FormFieldOption[] };
export type SubmittedAnswer = { fieldId: string; values: string[] };
export type AnswerRow = { field_id: string; value: string };

const FIELD_TYPES: readonly FormFieldType[] = [
  "single_select", "multi_select", "boolean", "short_text", "long_text", "scale",
];
const SEMANTIC_KEYS: readonly SemanticKey[] = ["attending", "can_transport", "notes"];
const CHOICE_TYPES: readonly FormFieldType[] = ["single_select", "multi_select", "scale"];
const TEXT_MAX = 2000;

/** PURE. Validates a submission against a form's fields; returns flat answer rows for the DB. */
export function validateAnswers(
  fields: FieldWithOptions[],
  submitted: SubmittedAnswer[],
): { ok: true; answers: AnswerRow[] } | { ok: false } {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const seen = new Map<string, string[]>();
  for (const s of submitted) {
    if (!byId.has(s.fieldId)) return { ok: false }; // unknown field
    seen.set(s.fieldId, (s.values ?? []).filter((v) => v.trim().length > 0));
  }

  const answers: AnswerRow[] = [];
  for (const field of fields) {
    const values = seen.get(field.id) ?? [];
    if (values.length === 0) {
      if (field.required) return { ok: false };
      continue;
    }
    if (CHOICE_TYPES.includes(field.type)) {
      const allowed = new Set(field.options.map((o) => o.value));
      if (field.type === "multi_select") {
        for (const v of values) if (!allowed.has(v)) return { ok: false };
      } else {
        if (values.length !== 1 || !allowed.has(values[0])) return { ok: false };
      }
    } else if (field.type === "boolean") {
      if (values.length !== 1 || (values[0] !== "true" && values[0] !== "false")) return { ok: false };
    } else {
      // short_text / long_text
      if (values.length !== 1 || values[0].length > TEXT_MAX) return { ok: false };
    }
    for (const v of values) answers.push({ field_id: field.id, value: v });
  }
  return { ok: true, answers };
}

/** PURE. Null = invalid. */
export function parseFormInput(
  body: unknown,
): { title: string; description: string | null; kind: string; status: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const title = reqString(b.title, 200);
  if (!title) return null;
  const description = optString(b.description, 2000);
  if (!description) return null;
  const kind = typeof b.kind === "string" ? b.kind : "event_signup";
  if (kind !== "event_signup") return null;
  const status = typeof b.status === "string" ? b.status : "draft";
  if (!["draft", "published", "closed"].includes(status)) return null;
  return { title, description: description.value, kind, status };
}

/** PURE. Null = invalid. */
export function parseFieldInput(body: unknown): {
  label: string; helpText: string | null; type: FormFieldType; required: boolean;
  position: number; semanticKey: string | null; options: { value: string; label: string; position: number }[];
} | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const label = reqString(b.label, 300);
  if (!label) return null;
  const type = b.type;
  if (typeof type !== "string" || !FIELD_TYPES.includes(type as FormFieldType)) return null;
  const helpText = optString(b.helpText, 1000);
  if (!helpText) return null;
  const required = b.required === true;
  const pos = optInt(b.position, 0, 1000);
  if (!pos || pos.value === null) return null;
  let semanticKey: string | null = null;
  if (b.semanticKey !== undefined && b.semanticKey !== null) {
    if (typeof b.semanticKey !== "string" || !SEMANTIC_KEYS.includes(b.semanticKey as SemanticKey)) return null;
    semanticKey = b.semanticKey;
  }
  const isChoice = CHOICE_TYPES.includes(type as FormFieldType);
  const options: { value: string; label: string; position: number }[] = [];
  if (isChoice) {
    if (!Array.isArray(b.options) || b.options.length === 0) return null;
    for (let i = 0; i < b.options.length; i++) {
      const o = b.options[i] as Record<string, unknown>;
      const value = reqString(o?.value, 200);
      const optLabel = reqString(o?.label, 300);
      if (!value || !optLabel) return null;
      options.push({ value, label: optLabel, position: i });
    }
  }
  return { label, helpText: helpText.value, type: type as FormFieldType, required, position: pos.value, semanticKey, options };
}
