import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meeting, MeetingRow } from "./types";
import { meetingFromRow } from "./types";
import { reqString } from "./validate";

export async function listUpcomingMeetings(
  nowIso: string,
  limit: number,
  db?: SupabaseClient,
): Promise<Meeting[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("meeting")
    .select("*")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(limit);
  return ((data ?? []) as MeetingRow[]).map(meetingFromRow);
}

export type ManualMeetingInput = { title: string; startsAt: string; endsAt: string };

/** Normalize a required ISO datetime string; null when missing/unparseable. */
function reqIso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

/** Validate + normalize a manual meeting payload. PURE. Null = invalid. */
export function parseMeetingInput(body: unknown): ManualMeetingInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const title = reqString(b.title, 200);
  const startsAt = reqIso(b.startsAt);
  const endsAt = reqIso(b.endsAt);
  if (!title || !startsAt || !endsAt) return null;
  if (Date.parse(endsAt) < Date.parse(startsAt)) return null;
  return { title, startsAt, endsAt };
}

/** Manual (admin-created) meetings always have gcal_event_id = null — the gcal
 * sync only ever upserts by a non-null gcal_event_id, so it can never match or
 * overwrite one of these rows. */
export async function createManualMeeting(
  input: ManualMeetingInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("meeting")
    .insert({
      gcal_event_id: null,
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: 500 };
  return { ok: true, id: data.id as string };
}

export async function updateMeeting(
  id: string,
  input: ManualMeetingInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("meeting")
    .update({ title: input.title, starts_at: input.startsAt, ends_at: input.endsAt })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteMeeting(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("meeting")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}
