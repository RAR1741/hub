import type { SupabaseClient } from "@supabase/supabase-js";
import { getFormWithFields, validateAnswers, type FieldWithOptions, type SubmittedAnswer } from "./forms";
import { displayName } from "./people";
import type { Form } from "./types";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const EVENT_NOT_OPEN = "P0100";

export async function submitEventSignupResponse(
  eventId: string,
  personId: string,
  formId: string,
  submitted: SubmittedAnswer[],
  db?: SupabaseClient,
  form?: { form: Form; fields: FieldWithOptions[] } | null,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const loaded = form !== undefined ? form : await getFormWithFields(formId, client);
  if (!loaded) return { ok: false, status: 404 };
  const validated = validateAnswers(loaded.fields, submitted);
  if (!validated.ok) return { ok: false, status: 400 };
  const { error } = await client.rpc("submit_event_signup", {
    p_event_id: eventId,
    p_person_id: personId,
    p_form_id: formId,
    p_answers: validated.answers,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION || error.code === EVENT_NOT_OPEN) return { ok: false, status: 409 };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 400 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 201 };
}

export type ResponseRosterEntry = {
  personId: string;
  name: string;
  answers: { fieldId: string; value: string }[];
};

/** Every response for an event, joined to person + answers. Mentor-only surface. */
export async function listEventResponses(eventId: string, db?: SupabaseClient): Promise<ResponseRosterEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("form_response")
    .select("id, person_id, person(id, first_name, last_name, display_name), form_answer(field_id, value)")
    .eq("event_id", eventId);
  if (error) { console.error("listEventResponses failed", error); return []; }
  return ((data ?? []) as unknown as Array<{
    person_id: string;
    person: { first_name: string; last_name: string; display_name: string | null } | null;
    form_answer: { field_id: string; value: string | null }[];
  }>).map((r) => ({
    personId: r.person_id,
    name: r.person ? displayName(r.person) : r.person_id,
    answers: (r.form_answer ?? []).filter((a) => a.value !== null).map((a) => ({ fieldId: a.field_id, value: a.value as string })),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
