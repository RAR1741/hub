import type { SupabaseClient } from "@supabase/supabase-js";
import type { Event, EventRow } from "./types";
import { eventFromRow } from "./types";
import { optString, reqString, reqUuid } from "./validate";

export type EventInput = {
  name: string;
  periodId: string;
  location: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  gcalEventId: string | null;
  formId: string | null;
};

/** Validate an event payload. PURE. Null = invalid. */
export function parseEventInput(body: unknown): EventInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 120);
  const periodId = reqUuid(b.periodId);
  const startsAt =
    typeof b.startsAt === "string" && !Number.isNaN(Date.parse(b.startsAt))
      ? new Date(b.startsAt).toISOString()
      : null;
  const endsAt =
    typeof b.endsAt === "string" && !Number.isNaN(Date.parse(b.endsAt))
      ? new Date(b.endsAt).toISOString()
      : null;
  if (!name || !periodId || !startsAt || !endsAt) return null;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  const location = optString(b.location, 200);
  if (!location) return null;
  const description = optString(b.description, 1000);
  if (!description) return null;
  const gcalEventId = typeof b.gcalEventId === "string" && b.gcalEventId.trim() ? b.gcalEventId.trim() : null;
  let formId: string | null = null;
  if (b.formId !== undefined && b.formId !== null) {
    formId = reqUuid(b.formId);
    if (!formId) return null;
  }
  return {
    name,
    periodId,
    startsAt,
    endsAt,
    location: location.value,
    description: description.value,
    gcalEventId,
    formId,
  };
}

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

function mapWriteError(code: string | undefined): number {
  if (code === FOREIGN_KEY_VIOLATION) return 400;
  if (code === UNIQUE_VIOLATION) return 409;
  return 500;
}

type LinkedMeeting = { title: string; starts_at: string; ends_at: string };

/** The meeting a gcal_event_id points at, or null if it doesn't match one. */
async function lookupMeetingByGcalId(
  gcalEventId: string,
  db: SupabaseClient,
): Promise<LinkedMeeting | null> {
  const { data } = await db
    .from("meeting")
    .select("title, starts_at, ends_at")
    .eq("gcal_event_id", gcalEventId)
    .maybeSingle();
  return (data as LinkedMeeting | null) ?? null;
}

/**
 * When `input.gcalEventId` is set, name/starts_at/ends_at come from the
 * matching `meeting` row — never from client-submitted text — so a linked
 * event can't be created or edited out of step with the calendar. Null =
 * the id didn't match any meeting (caller should 400).
 */
async function resolveLinkedFields(
  input: EventInput,
  db: SupabaseClient,
): Promise<{ name: string; startsAt: string; endsAt: string } | null> {
  if (!input.gcalEventId) return { name: input.name, startsAt: input.startsAt, endsAt: input.endsAt };
  const meeting = await lookupMeetingByGcalId(input.gcalEventId, db);
  if (!meeting) return null;
  return { name: meeting.title, startsAt: meeting.starts_at, endsAt: meeting.ends_at };
}

export async function createEvent(
  input: EventInput,
  creatorId: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const resolved = await resolveLinkedFields(input, client);
  if (!resolved) return { ok: false, status: 400 };
  const { data, error } = await client
    .from("event")
    .insert({
      name: resolved.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: resolved.startsAt,
      ends_at: resolved.endsAt,
      created_by: creatorId,
      gcal_event_id: input.gcalEventId,
      form_id: input.formId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
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
  const resolved = await resolveLinkedFields(input, client);
  if (!resolved) return { ok: false, status: 400 };
  const { data, error } = await client
    .from("event")
    .update({
      name: resolved.name,
      period_id: input.periodId,
      location: input.location,
      description: input.description,
      starts_at: resolved.startsAt,
      ends_at: resolved.endsAt,
      gcal_event_id: input.gcalEventId,
      form_id: input.formId,
      // Any admin edit clears a stale missing-flag: unlinking (gcalEventId
      // null) should stop showing the banner, and re-pointing a flagged event
      // at a live meeting should too — the next sync run would eventually
      // clear it, but there's no reason to make the admin wait for that.
      gcal_missing: false,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: mapWriteError(error.code) };
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

export type GcalCandidate = { id: string; title: string; startsAt: string; endsAt: string };

type MeetingLite = { gcal_event_id: string; title: string; starts_at: string; ends_at: string };

/**
 * Upcoming synced calendar events not yet linked to any `event` row — the
 * admin event form's "attach to a calendar event" picker. No live Google
 * API call: `meeting` is already kept current by the calendar sync cron.
 */
export async function listGcalCandidates(
  db?: SupabaseClient,
  excludeEventId?: string,
): Promise<GcalCandidate[]> {
  const client = db ?? (await import("./db")).getDb();
  // Excluding excludeEventId's own claim lets the edit form re-show the
  // calendar event an event is ALREADY linked to as a selectable candidate —
  // otherwise editing a linked event would find its own link filtered out.
  let claimedQuery = client.from("event").select("gcal_event_id").not("gcal_event_id", "is", null);
  if (excludeEventId) claimedQuery = claimedQuery.neq("id", excludeEventId);
  const [{ data: meetings }, { data: claimed }] = await Promise.all([
    client
      .from("meeting")
      .select("gcal_event_id, title, starts_at, ends_at")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }),
    claimedQuery,
  ]);
  const claimedIds = new Set(((claimed ?? []) as { gcal_event_id: string }[]).map((c) => c.gcal_event_id));
  return ((meetings ?? []) as MeetingLite[])
    .filter((m) => !claimedIds.has(m.gcal_event_id))
    .map((m) => ({ id: m.gcal_event_id, title: m.title, startsAt: m.starts_at, endsAt: m.ends_at }));
}

/** Clears a calendar link (and any missing-flag) without touching anything else on the event. */
export async function unlinkEvent(id: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("event")
    .update({ gcal_event_id: null, gcal_missing: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}
