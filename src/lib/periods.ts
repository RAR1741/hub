import type { SupabaseClient } from "@supabase/supabase-js";
import type { Period, PeriodRow } from "./types";
import { periodFromRow } from "./types";
import { reqString } from "./validate";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodInput = { name: string; startsOn: string; endsOn: string };

/** Validate a period payload. PURE. Null = invalid. */
export function parsePeriodInput(body: unknown): PeriodInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 80);
  const startsOn = typeof b.startsOn === "string" && ISO_DATE.test(b.startsOn) ? b.startsOn : null;
  const endsOn = typeof b.endsOn === "string" && ISO_DATE.test(b.endsOn) ? b.endsOn : null;
  if (!name || !startsOn || !endsOn) return null;
  if (Date.parse(endsOn) < Date.parse(startsOn)) return null;
  return { name, startsOn, endsOn };
}

const UNIQUE_VIOLATION = "23505";

export async function listPeriods(db?: SupabaseClient): Promise<Period[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("period").select("*").order("starts_on", { ascending: false });
  return ((data ?? []) as PeriodRow[]).map(periodFromRow);
}

export async function getActivePeriod(db?: SupabaseClient): Promise<Period | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("period").select("*").eq("is_active", true).maybeSingle();
  return data ? periodFromRow(data as PeriodRow) : null;
}

/** Look up a period by id. Returns null if not found (or the id is malformed). */
export async function getPeriod(id: string, db?: SupabaseClient): Promise<Period | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("period").select("*").eq("id", id).maybeSingle();
  return data ? periodFromRow(data as PeriodRow) : null;
}

export async function createPeriod(
  input: PeriodInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("period")
    .insert({ name: input.name, starts_on: input.startsOn, ends_on: input.endsOn })
    .select("id")
    .single();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  return { ok: true, id: data.id as string };
}

export async function updatePeriod(
  id: string,
  input: PeriodInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("period")
    .update({ name: input.name, starts_on: input.startsOn, ends_on: input.endsOn })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Hard-delete a period. `session.period_id references period on delete
 * restrict` (20260811060855_attendance.sql), so a period with attendance
 * history is protected at the DB level too — but a clean 409 with a clear
 * message beats a raw 23503, so this checks explicitly first.
 */
export async function deletePeriod(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("period").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { data: sessions } = await client.from("session").select("id").eq("period_id", id).limit(1);
  if (sessions && sessions.length > 0) return { ok: false, status: 409 };
  const { error } = await client.from("period").delete().eq("id", id);
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 409 : 500 };
  return { ok: true, status: 200 };
}

/** Exactly one active period, enforced by the `one_active_period` partial unique index. */
export async function setActivePeriod(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("period").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  // Clear the current active row first, then set this one. The partial unique
  // index rejects any state with two active periods, so concurrent callers can't
  // both win — the loser gets a 23505 surfaced as 500 and simply retries.
  const { error: clearError } = await client
    .from("period").update({ is_active: false }).eq("is_active", true);
  if (clearError) return { ok: false, status: 500 };
  const { error } = await client.from("period").update({ is_active: true }).eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
