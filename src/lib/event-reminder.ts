// src/lib/event-reminder.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";
import { dueOffsets, MAX_REMINDER_MS } from "./reminder-minutes";

type EventRow = { id: string; name: string; starts_at: string };

/** Sweeps event_signup_reminder rows due in the next 2h window, claims every due
 *  offset by stamping pushed_at, then sends one push per claimed recipient. No
 *  direct FK from event_signup_reminder to event/person — load separately. */
export async function pushEventReminders(deps: {
  db: SupabaseClient;
  push?: PushDeps;
  nowIso?: string;
}): Promise<{ sent: number; pruned: number; events: number; errors: number }> {
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const until = new Date(Date.parse(nowIso) + MAX_REMINDER_MS).toISOString();

  const { data: eventData, error: eventError } = await deps.db
    .from("event")
    .select("id, name, starts_at")
    .gte("starts_at", nowIso)
    .lte("starts_at", until);
  if (eventError) {
    console.error("[event-reminder] load events failed:", eventError.message);
    return { sent: 0, pruned: 0, events: 0, errors: 1 };
  }
  const events = (eventData ?? []) as EventRow[];
  if (events.length === 0) return { sent: 0, pruned: 0, events: 0, errors: 0 };

  const push = deps.push ?? pushDepsFromEnv();
  let sent = 0;
  let pruned = 0;
  let eventsSent = 0;
  let errors = 0;
  for (const event of events) {
    const dueM = dueOffsets(Date.parse(event.starts_at), Date.parse(nowIso), []);
    if (dueM.length === 0) continue;

    // Claim before sending. The conditional update is atomic, so an overlapping
    // tick that reaches it second matches zero rows and sends nothing. Cost of
    // stamping first: a reminder is dropped if the process dies mid-run
    // (sendPushToOptedIn itself never throws).
    const { data: claimed, error: claimError } = await deps.db
      .from("event_signup_reminder")
      .update({ pushed_at: nowIso })
      .eq("event_id", event.id)
      .in("minutes", dueM)
      .is("pushed_at", null)
      .select("person_id");
    if (claimError) {
      console.error("[event-reminder] claim reminders failed:", claimError.message);
      errors++;
      continue;
    }
    const recipients = [
      ...new Set(((claimed ?? []) as { person_id: string }[]).map((r) => r.person_id)),
    ];
    if (recipients.length === 0) continue;

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
  }
  return { sent, pruned, events: eventsSent, errors };
}
