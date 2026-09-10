// src/lib/event-reminder.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";
import { dueOffsets, MAX_REMINDER_MS } from "./reminder-minutes";

type EventRow = { id: string; name: string; starts_at: string };
type ReminderRow = { event_id: string; person_id: string; minutes: number };

/** Sweeps event_signup_reminder rows due in the next 2h window, sends one push
 *  per recipient per event, then stamps every due offset. No direct FK from
 *  event_signup_reminder to event/person — load separately, join in JS. */
export async function pushEventReminders(deps: {
  db: SupabaseClient;
  push?: PushDeps;
  nowIso?: string;
}): Promise<{ sent: number; pruned: number; events: number }> {
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const until = new Date(Date.parse(nowIso) + MAX_REMINDER_MS).toISOString();

  const { data: eventData, error: eventError } = await deps.db
    .from("event")
    .select("id, name, starts_at")
    .gte("starts_at", nowIso)
    .lte("starts_at", until);
  if (eventError) {
    console.error("[event-reminder] load events failed:", eventError.message);
    return { sent: 0, pruned: 0, events: 0 };
  }
  const events = (eventData ?? []) as EventRow[];
  if (events.length === 0) return { sent: 0, pruned: 0, events: 0 };

  const ids = events.map((e) => e.id);
  const { data: reminderData, error: reminderError } = await deps.db
    .from("event_signup_reminder")
    .select("event_id, person_id, minutes")
    .in("event_id", ids)
    .is("pushed_at", null);
  if (reminderError) {
    console.error("[event-reminder] load reminders failed:", reminderError.message);
    return { sent: 0, pruned: 0, events: 0 };
  }
  const reminders = (reminderData ?? []) as ReminderRow[];

  const push = deps.push ?? pushDepsFromEnv();
  let sent = 0;
  let pruned = 0;
  let eventsSent = 0;
  for (const event of events) {
    const pending = reminders.filter((r) => r.event_id === event.id);
    if (pending.length === 0) continue;
    const dueM = dueOffsets(Date.parse(event.starts_at), Date.parse(nowIso), []);
    if (dueM.length === 0) continue;
    const due = pending.filter((r) => (dueM as readonly number[]).includes(r.minutes));
    if (due.length === 0) continue;
    const recipients = [...new Set(due.map((r) => r.person_id))];

    const when = new Date(event.starts_at).toLocaleString("en-US", {
      timeZone: "America/Indiana/Indianapolis",
      hour: "numeric",
      minute: "2-digit",
    });
    const res = await sendPushToOptedIn(
      recipients,
      null,
      { title: event.name, body: `Starts at ${when}`, url: `/events/${event.id}` },
      { db: deps.db, push },
    );
    sent += res.sent;
    pruned += res.pruned;
    eventsSent += 1;

    await deps.db
      .from("event_signup_reminder")
      .update({ pushed_at: nowIso })
      .eq("event_id", event.id)
      .in("minutes", dueM)
      .is("pushed_at", null);
  }
  return { sent, pruned, events: eventsSent };
}
