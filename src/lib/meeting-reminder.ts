// src/lib/meeting-reminder.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";
import { dueOffsets, MAX_REMINDER_MS } from "./reminder-minutes";

type MeetingRow = {
  id: string;
  title: string;
  starts_at: string;
  reminder_pushed_minutes: number[];
};

/** Reminds meetings whose next lead-time offset (person.meeting_reminder_minutes)
 *  is due, claiming the offsets in reminder_pushed_minutes before sending so each
 *  (meeting, offset) fires once even across overlapping cron ticks. */
export async function pushMeetingReminders(deps: {
  db: SupabaseClient;
  push?: PushDeps;
  nowIso?: string;
}): Promise<{ sent: number; pruned: number; meetings: number; errors: number }> {
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const until = new Date(Date.parse(nowIso) + MAX_REMINDER_MS).toISOString();
  const { data, error } = await deps.db
    .from("meeting")
    .select("id, title, starts_at, reminder_pushed_minutes")
    .gte("starts_at", nowIso)
    .lte("starts_at", until);
  if (error) {
    console.error("[meeting-reminder] load meetings failed:", error.message);
    return { sent: 0, pruned: 0, meetings: 0, errors: 1 };
  }
  const meetings = (data ?? []) as MeetingRow[];
  if (meetings.length === 0) return { sent: 0, pruned: 0, meetings: 0, errors: 0 };

  const push = deps.push ?? pushDepsFromEnv();
  let sent = 0;
  let pruned = 0;
  let meetingsSent = 0;
  let errors = 0;
  for (const m of meetings) {
    const dueM = dueOffsets(Date.parse(m.starts_at), Date.parse(nowIso), m.reminder_pushed_minutes);
    if (dueM.length === 0) continue;

    const { data: personData, error: personError } = await deps.db
      .from("person")
      .select("id")
      .overlaps("meeting_reminder_minutes", dueM);
    if (personError) {
      console.error("[meeting-reminder] load persons failed:", personError.message);
      errors++;
      continue;
    }
    const ids = ((personData ?? []) as { id: string }[]).map((p) => p.id);

    // Claim before sending. `not.ov` turns the stamp into a compare-and-swap on
    // the array: an overlapping tick that lands second sees the offsets already
    // present, updates zero rows, and neither re-sends nor clobbers the first
    // tick's write. Cost of stamping first: a reminder is dropped if the process
    // dies mid-run (sendPushToOptedIn itself never throws).
    const union = [...new Set([...m.reminder_pushed_minutes, ...dueM])].sort((a, b) => a - b);
    const { data: claimed, error: claimError } = await deps.db
      .from("meeting")
      .update({ reminder_pushed_minutes: union })
      .eq("id", m.id)
      .not("reminder_pushed_minutes", "ov", `{${dueM.join(",")}}`)
      .select("id");
    if (claimError) {
      console.error("[meeting-reminder] claim meeting failed:", claimError.message);
      errors++;
      continue;
    }
    if (((claimed ?? []) as { id: string }[]).length === 0) continue;

    if (ids.length > 0) {
      const when = new Date(m.starts_at).toLocaleString("en-US", {
        timeZone: "America/Indiana/Indianapolis",
        hour: "numeric",
        minute: "2-digit",
      });
      const res = await sendPushToOptedIn(
        ids,
        "meeting_reminder",
        { title: `Meeting at ${when}`, body: m.title || "Team meeting", url: "/calendar" },
        { db: deps.db, push },
      );
      sent += res.sent;
      pruned += res.pruned;
      meetingsSent += 1;
    }
  }
  return { sent, pruned, meetings: meetingsSent, errors };
}
