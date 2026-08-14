import type { SupabaseClient } from "@supabase/supabase-js";
import type { Excusal, ExcusalRow } from "./types";
import { excusalFromRow } from "./types";
import { optString, reqString } from "./validate";
import { fetchAllRows } from "./paginate";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ExcusalInput = { personId: string; date: string; note: string | null };

/** Validate an excusal payload. PURE. */
export function parseExcusalInput(body: unknown): ExcusalInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const personId = reqString(b.personId, 64);
  const date = typeof b.date === "string" && ISO_DATE.test(b.date) && !Number.isNaN(Date.parse(b.date))
    ? b.date
    : null;
  const note = optString(b.note, 500);
  if (!personId || !date || !note) return null;
  return { personId, date, note: note.value };
}

export async function listExcusals(
  range: { from: string; to: string },
  db?: SupabaseClient,
): Promise<Excusal[]> {
  const client = db ?? (await import("./db")).getDb();
  // Page past the 1000-row cap — a full season's excusals can exceed it.
  const { rows: data } = await fetchAllRows(async (from, to) => {
    const r = await client
      .from("excusal")
      .select("*")
      .gte("date", range.from)
      .lte("date", range.to)
      .order("date")
      .order("id")
      .range(from, to);
    return { data: r.data as ExcusalRow[] | null, error: r.error };
  });
  return (data as ExcusalRow[]).map(excusalFromRow);
}

export async function createExcusal(
  input: ExcusalInput,
  createdBy: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("excusal")
    .upsert(
      { person_id: input.personId, date: input.date, note: input.note, created_by: createdBy },
      { onConflict: "person_id,date" },
    );
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function deleteExcusal(
  personId: string,
  date: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("excusal")
    .delete()
    .eq("person_id", personId)
    .eq("date", date);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
