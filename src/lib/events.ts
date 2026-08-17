import type { SupabaseClient } from "@supabase/supabase-js";
import type { Event, EventRow } from "./types";
import { eventFromRow } from "./types";
import { optString, reqString } from "./validate";

export type EventInput = {
  name: string;
  periodId: string;
  location: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
};

/** Validate an event payload. PURE. Null = invalid. */
export function parseEventInput(body: unknown): EventInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 120);
  const periodId = reqString(b.periodId, 64);
  const startsAt =
    typeof b.startsAt === "string" && !Number.isNaN(Date.parse(b.startsAt))
      ? b.startsAt
      : null;
  const endsAt =
    typeof b.endsAt === "string" && !Number.isNaN(Date.parse(b.endsAt))
      ? b.endsAt
      : null;
  if (!name || !periodId || !startsAt || !endsAt) return null;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  const location = optString(b.location, 200);
  if (!location) return null;
  const description = optString(b.description, 1000);
  if (!description) return null;
  return { name, periodId, startsAt, endsAt, location: location.value, description: description.value };
}

const FOREIGN_KEY_VIOLATION = "23503";

export async function createEvent(
  input: EventInput,
  creatorId: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("event")
    .insert({
      name: input.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      created_by: creatorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 400 : 500 };
  return { ok: true, id: data.id as string };
}

export async function listEvents(db?: SupabaseClient): Promise<Event[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("event").select("*").order("starts_at", { ascending: false });
  return ((data ?? []) as EventRow[]).map(eventFromRow);
}

/** Events that haven't ended yet, soonest first — the sign-up page's list. */
export async function listUpcomingEvents(db?: SupabaseClient): Promise<Event[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("event")
    .select("*")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  return ((data ?? []) as EventRow[]).map(eventFromRow);
}

export async function getEvent(id: string, db?: SupabaseClient): Promise<Event | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("event").select("*").eq("id", id).maybeSingle();
  return data ? eventFromRow(data as EventRow) : null;
}

export async function updateEvent(
  id: string,
  input: EventInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("event")
    .update({
      name: input.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 400 : 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/**
 * Hard-delete an event. `session.event_id references event on delete
 * restrict`, so an event with check-in history is protected at the DB level
 * too — but a clean 409 beats a raw 23503, so this checks explicitly first.
 * `event_signup` rows cascade-delete automatically.
 */
export async function deleteEvent(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("event").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { data: sessions } = await client.from("session").select("id").eq("event_id", id).limit(1);
  if (sessions && sessions.length > 0) return { ok: false, status: 409 };
  const { error } = await client.from("event").delete().eq("id", id);
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 409 : 500 };
  return { ok: true, status: 200 };
}
