import type { SupabaseClient } from "@supabase/supabase-js";
import { optString, reqString } from "./validate";

function isoOrNull(v: unknown): string | null | undefined {
  // undefined = absent; null-return = invalid; string = normalized ISO
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

export type SessionEdit = {
  timeIn: string;
  timeOut: string | null;
  note: string | null;
  excludedFromTotals: boolean;
};

export function parseSessionEdit(body: unknown): SessionEdit | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const timeIn = typeof b.timeIn === "string" && !Number.isNaN(Date.parse(b.timeIn))
    ? new Date(b.timeIn).toISOString()
    : null;
  if (!timeIn) return null;
  const timeOut = isoOrNull(b.timeOut);
  if (timeOut === undefined) return null; // present but invalid
  if (timeOut && Date.parse(timeOut) < Date.parse(timeIn)) return null;
  const note = optString(b.note, 500);
  if (!note) return null;
  const excludedFromTotals = typeof b.excludedFromTotals === "boolean" ? b.excludedFromTotals : null;
  if (excludedFromTotals === null) return null;
  return { timeIn, timeOut, note: note.value, excludedFromTotals };
}

export type ManualSession = {
  personId: string;
  timeIn: string;
  timeOut: string | null;
  note: string | null;
};

export function parseManualSession(body: unknown): ManualSession | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const personId = reqString(b.personId, 64);
  const timeIn = typeof b.timeIn === "string" && !Number.isNaN(Date.parse(b.timeIn))
    ? new Date(b.timeIn).toISOString()
    : null;
  if (!personId || !timeIn) return null;
  const timeOut = isoOrNull(b.timeOut);
  if (timeOut === undefined) return null;
  if (timeOut && Date.parse(timeOut) < Date.parse(timeIn)) return null;
  const note = optString(b.note, 500);
  if (!note) return null;
  return { personId, timeIn, timeOut, note: note.value };
}

export async function updateSession(
  id: string,
  edit: SessionEdit,
  editorId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("session")
    .update({
      time_in: edit.timeIn,
      time_out: edit.timeOut,
      note: edit.note,
      excluded_from_totals: edit.excludedFromTotals,
      edited_by: editorId,
      edited_at: new Date().toISOString(),
      // Saving a session is reviewing it: mark it resolved so it drops off the
      // flagged screen even if it still carries a flag (e.g. an accepted
      // over_max shift). A later re-import replaces the row and re-flags it.
      flags_resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, status: 409 };
    return { ok: false, status: 500 };
  }
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteSession(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("session").delete().eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function createManualSession(
  input: ManualSession,
  editorId: string,
  periodId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("session").insert({
    person_id: input.personId,
    period_id: periodId,
    time_in: input.timeIn,
    time_out: input.timeOut,
    note: input.note,
    source: "manual",
    edited_by: editorId,
    edited_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, status: 409 }; // would create a 2nd open session
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}
