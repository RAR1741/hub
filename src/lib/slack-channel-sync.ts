import type { SupabaseClient } from "@supabase/supabase-js";
import { inviteToChannelDetailed } from "./slack-channels";
import { postChannelMessage, slackDepsFromEnv, type SlackDeps } from "./slack";
import { displayName } from "./people";

/** `` `code` `` plus a one-line hint for well-known failure codes, else just the code. */
function errorHint(error: string): string {
  if (error === "not_in_channel") {
    return "`not_in_channel` — the bot isn't in that channel; invite it (`/invite @bot`) and re-add the member or wait for the next join.";
  }
  if (error === "channel_not_found") {
    return "`channel_not_found` — check the channel ID on the team's admin page.";
  }
  return `\`${error}\``;
}

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
      .select("slack_channel_id, label")
      .eq("team_id", teamId);
    if (channelsError) throw new Error(channelsError.message);
    const channelRows = (channels ?? []) as { slack_channel_id: string; label: string | null }[];
    if (channelRows.length === 0) return;

    const { data: person, error: personError } = await db
      .from("person")
      .select("slack_user_id, first_name, last_name, display_name")
      .eq("id", personId)
      .maybeSingle();
    if (personError) throw new Error(personError.message);
    const p = person as { slack_user_id: string | null; first_name: string; last_name: string; display_name: string | null } | null;
    const slackUserId = p?.slack_user_id;
    if (!slackUserId) {
      console.log("[slack-channel-sync] person has no slack_user_id; skipping invites", { teamId, personId });
      return;
    }
    const name = p ? displayName(p) : personId;

    const { data: team, error: teamError } = await db.from("team").select("name").eq("id", teamId).maybeSingle();
    if (teamError) console.error("[slack-channel-sync] team lookup failed:", teamError);
    const teamName = (team as { name?: string } | null)?.name ?? teamId;

    for (const channel of channelRows) {
      const result = await inviteToChannelDetailed(deps, channel.slack_channel_id, [slackUserId]);
      if (!result.ok && result.error) {
        const label = channel.label?.replace(/^#/, "");
        const channelRef = label ? `#${label} (\`${channel.slack_channel_id}\`)` : `\`${channel.slack_channel_id}\``;
        const text = `:warning: Couldn't invite *${name}* to ${channelRef} for team *${teamName}*: ${errorHint(result.error)}`;
        await postChannelMessage(deps, "hub-admin-alerts", text);
      }
    }
  } catch (error) {
    console.error("slack-channel sync failed", { action, teamId, personId, error });
  }
}
