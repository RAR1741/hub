import type { SupabaseClient } from "@supabase/supabase-js";
import { postChannelMessage, sendDM, type SlackDeps } from "./slack";

export type MentorReq = {
  personId: string;
  name: string;
  slackUserId: string | null;
  consent: boolean | null;
  screeningStatus: string | null;
  trainingStatus: string | null;
};

// ponytail: "green" = satisfied for screening/training, matching the values the
// FIRST sync currently stores (see first-sync.ts screeningStatus comment and
// the first-status page). Confirm against real synced data before prod; widen
// this set here if FIRST reports another passing value.
const SATISFIED = new Set(["green"]);

/** Human-readable list of a mentor's still-outstanding FIRST requirements. PURE. */
export function outstandingItems(m: MentorReq): string[] {
  const items: string[] = [];
  if (m.consent !== true) items.push("Consent & release form");
  if (!m.screeningStatus || !SATISFIED.has(m.screeningStatus)) items.push("Youth Protection screening");
  if (!m.trainingStatus || !SATISFIED.has(m.trainingStatus)) items.push("Required training");
  return items;
}

export function buildReminderText(name: string, items: string[]): string {
  const lines = items.map((i) => `  • ${i}`).join("\n");
  return `Hi ${name}! You still have outstanding FIRST requirements:\n${lines}\n\nPlease complete them at https://my.firstinspires.org — thanks!`;
}

/**
 * DM every LINKED mentor who has outstanding FIRST requirements their specific
 * list, paced to respect Slack rate limits, and post one summary to #hub-admin-alerts
 * that names any incomplete mentor who couldn't be DMed (no Slack link).
 */
export async function sendMentorReminders(deps: {
  db: SupabaseClient;
  slack: SlackDeps;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ reminded: number; unlinked: string[]; complete: number; failed: string[] }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const { data, error } = await deps.db
    .from("person")
    .select("id, first_name, last_name, display_name, slack_user_id, first_consent_release, first_screening_status, first_training_status, first_people_id")
    .in("role", ["mentor", "admin"])
    .eq("is_active", true);
  if (error) throw new Error(`mentor-reminders: load person failed: ${error.message}`);

  const mentors: MentorReq[] = (data ?? []).map((p: Record<string, unknown>) => ({
    personId: p.id as string,
    name: (p.display_name as string | null) ?? `${p.first_name} ${p.last_name}`,
    slackUserId: (p.slack_user_id as string | null) ?? null,
    // Never synced (no first_people_id) ⇒ treat as unknown/null, i.e. incomplete.
    consent: p.first_people_id == null ? null : ((p.first_consent_release as boolean | null) ?? null),
    screeningStatus: (p.first_screening_status as string | null) ?? null,
    trainingStatus: (p.first_training_status as string | null) ?? null,
  }));

  let reminded = 0;
  let complete = 0;
  const unlinked: string[] = [];
  const failed: string[] = [];

  for (const m of mentors) {
    const items = outstandingItems(m);
    if (items.length === 0) { complete++; continue; }
    if (!m.slackUserId) { unlinked.push(m.name); continue; }
    const ok = await sendDM(deps.slack, m.slackUserId, buildReminderText(m.name, items));
    if (ok) reminded++;
    else failed.push(m.name);
    await sleep(1100); // ~1 msg/sec
  }

  const summary =
    `:memo: Weekly FIRST reminder run — DMed ${reminded} mentor(s); ${complete} fully complete.` +
    (unlinked.length ? `\n:warning: No Slack link (not reminded): ${unlinked.join(", ")}` : "") +
    (failed.length ? `\n:x: DM failed (not reminded): ${failed.join(", ")}` : "");
  await postChannelMessage(deps.slack, "hub-admin-alerts", summary);

  return { reminded, unlinked, complete, failed };
}
