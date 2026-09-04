import type { SupabaseClient } from "@supabase/supabase-js";
import { inviteToChannel } from "./slack-channels";
import { slackDepsFromEnv, type SlackDeps } from "./slack";

/**
 * Best-effort real-time sync for a single team membership change: invites the
 * person to every Slack channel linked to the team. ADD-ONLY — removal never
 * kicks anyone out of a channel. Never throws.
 */
export async function syncSlackMembershipChange(
  action: "add" | "remove",
  teamId: string,
  personId: string,
  db: SupabaseClient,
  slack?: SlackDeps,
): Promise<void> {
  try {
    if (action !== "add") return;

    const deps = slack ?? slackDepsFromEnv();
    if (!deps.token) return;

    const { data: channels, error: channelsError } = await db
      .from("team_slack_channel")
      .select("slack_channel_id")
      .eq("team_id", teamId);
    if (channelsError) throw new Error(channelsError.message);
    const channelRows = (channels ?? []) as { slack_channel_id: string }[];
    if (channelRows.length === 0) return;

    const { data: person, error: personError } = await db.from("person").select("slack_user_id").eq("id", personId).maybeSingle();
    if (personError) throw new Error(personError.message);
    const slackUserId = (person as { slack_user_id: string | null } | null)?.slack_user_id;
    if (!slackUserId) return;

    for (const channel of channelRows) {
      await inviteToChannel(deps, channel.slack_channel_id, [slackUserId]);
    }
  } catch (error) {
    console.error("slack-channel sync failed", { action, teamId, personId, error });
  }
}
