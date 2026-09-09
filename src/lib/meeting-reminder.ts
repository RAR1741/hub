// src/lib/meeting-reminder.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

const LEAD_MS = 3 * 60 * 60 * 1000; // 3 hours

/** Reminds meetings starting within the next 3h that haven't been reminded yet,
 *  then stamps reminder_pushed_at so each meeting fires only once. */
export async function pushMeetingReminders(deps: {
  db: SupabaseClient;
  push?: PushDeps;
  nowIso: string;
}): Promise<{ sent: number; pruned: number; meetings: number }> {
  const now = new Date(deps.nowIso);
  const until = new Date(now.getTime() + LEAD_MS).toISOString();
  const { data, error } = await deps.db
    .from("meeting")
    .select("id, title, starts_at")
    .gte("starts_at", deps.nowIso)
    .lte("starts_at", until)
    .is("reminder_pushed_at", null);
  if (error) {
    console.error("[meeting-reminder] load meetings failed:", error.message);
    return { sent: 0, pruned: 0, meetings: 0 };
  }
  const meetings = (data ?? []) as { id: string; title: string; starts_at: string }[];
  if (meetings.length === 0) return { sent: 0, pruned: 0, meetings: 0 };

  const push = deps.push ?? pushDepsFromEnv();
  let sent = 0;
  let pruned = 0;
  for (const m of meetings) {
    const when = new Date(m.starts_at).toLocaleString("en-US", {
      timeZone: "America/Indiana/Indianapolis",
      hour: "numeric",
      minute: "2-digit",
    });
    const res = await sendPushToOptedIn(
      "all",
      "meeting_reminder",
      { title: `Meeting at ${when}`, body: m.title || "Team meeting", url: "/calendar" },
      { db: deps.db, push },
    );
    sent += res.sent;
    pruned += res.pruned;
    await deps.db.from("meeting").update({ reminder_pushed_at: deps.nowIso }).eq("id", m.id);
  }
  return { sent, pruned, meetings: meetings.length };
}
