import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "./people";
import { getEvent } from "./events";
import { afterEventSignup } from "./slack-channels";
import { slackDepsFromEnv, type SlackDeps } from "./slack";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** 409 if the event doesn't exist or has already ended — no signing up for the past. */
export async function signUpForEvent(
  eventId: string,
  personId: string,
  db?: SupabaseClient,
  slack?: SlackDeps,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  // getEvent selects "*", so event already carries slackChannelId/slackArchivedAt.
  const event = await getEvent(eventId, client);
  if (!event || Date.parse(event.endsAt) <= Date.now()) return { ok: false, status: 409 };
  const { error } = await client.from("event_signup").insert({ event_id: eventId, person_id: personId });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, status: 409 };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 400 };
    return { ok: false, status: 500 };
  }
  // DB write above already committed; Slack can never change the result below.
  try {
    await afterEventSignup(
      { db: client, slack: slack ?? slackDepsFromEnv() },
      { id: eventId, slackChannelId: event.slackChannelId, slackArchivedAt: event.slackArchivedAt },
      personId,
    );
  } catch (e) {
    console.error("signUpForEvent: afterEventSignup threw:", e);
  }
  return { ok: true, status: 201 };
}

export async function cancelEventSignup(
  eventId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("event_signup")
    .delete()
    .eq("event_id", eventId)
    .eq("person_id", personId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

type PersonLite = { id: string; first_name: string; last_name: string; display_name: string | null; role: string };

export type RosterEntry = {
  personId: string;
  name: string;
  role: string;
  signedUp: boolean;
  checkedIn: boolean;
  sessionId: string | null;
};

/**
 * An event's roster: everyone who signed up, plus anyone checked in who
 * didn't (a mentor's manual add). `session` has two person FKs (person_id +
 * edited_by), so its embed uses the `person!person_id` hint to avoid
 * PostgREST's PGRST201 ambiguous-embed error; `event_signup` has only one
 * person FK so no hint is needed there.
 */
export async function listEventRoster(eventId: string, db?: SupabaseClient): Promise<RosterEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const [{ data: signups, error: signupError }, { data: sessions, error: sessionError }] = await Promise.all([
    client.from("event_signup").select("person_id, person(id, first_name, last_name, display_name, role)").eq("event_id", eventId),
    client.from("session").select("id, person_id, person!person_id(id, first_name, last_name, display_name, role)").eq("event_id", eventId).eq("source", "event"),
  ]);
  if (signupError) console.error("listEventRoster: signup query failed", signupError);
  if (sessionError) console.error("listEventRoster: session query failed", sessionError);

  const entries = new Map<string, RosterEntry>();
  for (const s of signups ?? []) {
    if (!s.person) continue;
    const p = s.person as unknown as PersonLite;
    entries.set(p.id, { personId: p.id, name: displayName(p), role: p.role, signedUp: true, checkedIn: false, sessionId: null });
  }
  for (const s of sessions ?? []) {
    if (!s.person) continue;
    const p = s.person as unknown as PersonLite;
    const existing = entries.get(p.id);
    if (existing) {
      existing.checkedIn = true;
      existing.sessionId = s.id as string;
    } else {
      entries.set(p.id, { personId: p.id, name: displayName(p), role: p.role, signedUp: false, checkedIn: true, sessionId: s.id as string });
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check a person into an event: full event-duration credit, `source='event'`,
 * `edited_by`=the mentor running the roster (matches `createManualSession`'s
 * convention for mentor-entered sessions). Works whether or not the person
 * signed up first (manual add). 409 if already checked in to this event
 * (the `one_session_per_person_per_event` partial unique index).
 */
export async function checkInPerson(
  eventId: string,
  personId: string,
  mentorId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const event = await getEvent(eventId, client);
  if (!event) return { ok: false, status: 404 };
  const { error } = await client.from("session").insert({
    person_id: personId,
    period_id: event.periodId,
    event_id: eventId,
    time_in: event.startsAt,
    time_out: event.endsAt,
    source: "event",
    edited_by: mentorId,
    edited_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, status: 409 };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 400 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 201 };
}

/**
 * Undo a mistaken check-in. Scoped to source='event' AND the given eventId,
 * so it can never delete a kiosk/manual/admin session, or a session
 * belonging to a different event, even if the caller has/guesses another
 * event's session id. 404 if the session doesn't exist (or doesn't match).
 */
export async function uncheckIn(
  eventId: string,
  sessionId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("session")
    .delete()
    .eq("id", sessionId)
    .eq("source", "event")
    .eq("event_id", eventId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Event ids the given person has signed up for, among the given event ids. */
export async function signedUpEventIds(
  personId: string,
  eventIds: string[],
  db?: SupabaseClient,
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("event_signup")
    .select("event_id")
    .eq("person_id", personId)
    .in("event_id", eventIds);
  return new Set((data ?? []).map((r) => r.event_id as string));
}
