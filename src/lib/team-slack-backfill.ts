import type { SupabaseClient } from "@supabase/supabase-js";
import { inviteToChannelDetailed, listChannelMembers, type InviteResult } from "./slack-channels";
import { slackDepsFromEnv, type SlackDeps } from "./slack";
import { displayName } from "./people";
import { subtreeIds, type TeamLink } from "./team-tree";

/** One effective (subtree) member who can be invited to Slack. */
export type SlackTarget = { personId: string; slackUserId: string; name: string };

export type EffectiveSlackMembers = {
  /** Distinct ACTIVE members across the team's subtree (deduped by person). */
  effectiveActive: number;
  /** Effective members with a `slack_user_id` — the ones we can invite. */
  withSlack: SlackTarget[];
  /** Effective members lacking a `slack_user_id` — reported as skipped. */
  withoutSlackCount: number;
};

type PersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  slack_user_id: string | null;
  is_active: boolean;
};

/**
 * Load the team's effective membership — every ACTIVE person who is a member of
 * the team or any descendant — deduped by person, split by whether they have a
 * `slack_user_id`. This is the "effective members (its subtree)" set from the
 * umbrella-team resource-inheritance design, matching how the Drive/GitHub
 * reconciles compute their expected sets (`is_active` filter, subtree dedupe).
 */
export async function computeEffectiveSlackMembers(
  db: SupabaseClient,
  teamId: string,
): Promise<EffectiveSlackMembers> {
  const { data: treeData, error: treeError } = await db.from("team").select("id, parent_team_id");
  if (treeError) throw new Error(`list team tree failed: ${treeError.message}`);
  const tree: TeamLink[] = ((treeData ?? []) as { id: string; parent_team_id: string | null }[]).map((t) => ({
    id: t.id,
    parentTeamId: t.parent_team_id,
  }));
  const subtree = subtreeIds(tree, teamId);

  const { data: memberships, error: membershipError } = await db
    .from("team_membership")
    .select("person (id, first_name, last_name, display_name, slack_user_id, is_active)")
    .in("team_id", subtree);
  if (membershipError) throw new Error(membershipError.message);

  // Dedupe by person.id: someone can surface once per team in the subtree they
  // belong to (e.g. a direct member of both the umbrella and a descendant).
  const byId = new Map<string, PersonRow>();
  for (const m of (memberships ?? []) as unknown as { person: PersonRow | PersonRow[] | null }[]) {
    const p = Array.isArray(m.person) ? m.person[0] : m.person;
    if (!p || !p.is_active) continue;
    byId.set(p.id, p);
  }

  const withSlack: SlackTarget[] = [];
  let withoutSlackCount = 0;
  for (const p of byId.values()) {
    if (p.slack_user_id) {
      withSlack.push({ personId: p.id, slackUserId: p.slack_user_id, name: displayName(p) });
    } else {
      withoutSlackCount++;
    }
  }
  withSlack.sort((a, b) => a.name.localeCompare(b.name));
  return { effectiveActive: byId.size, withSlack, withoutSlackCount };
}

export type ChannelBackfillResult = {
  channelId: string;
  label: string | null;
  invited: number; // newly invited this run (an upper bound when membersReadFailed)
  alreadyIn: number; // effective members already in the channel (0/unknown when membersReadFailed)
  skippedNoSlack: number; // effective members with no slack_user_id (same for every channel)
  failed: number; // effective members we tried but Slack rejected
  membersReadFailed?: boolean; // couldn't read current membership, so the invited/already-in split is unknown
  error?: string; // Slack error code when the invite failed
};

export type TeamSlackBackfillSummary = {
  effectiveActive: number;
  withSlackCount: number;
  withoutSlackCount: number;
  /** False when Slack isn't wired up in this environment (no token / non-prod). */
  slackConfigured: boolean;
  channels: ChannelBackfillResult[];
};

/** Fold an invite outcome for `count` attempted users into a channel result. */
function applyInvite(result: ChannelBackfillResult, invite: InviteResult, count: number): void {
  if (invite.ok) {
    result.invited += count;
  } else {
    result.failed += count;
    if (invite.error) result.error = invite.error;
  }
}

/**
 * One-shot Slack backfill for a team: invite every effective (subtree) member
 * with a `slack_user_id` to each Slack channel linked to the team. ADD-ONLY —
 * this never removes anyone, matching the join-time sync. Idempotent: it reads
 * each channel's current membership first, so people already in are reported as
 * `alreadyIn` and only the genuinely-missing are invited.
 *
 * Never removes and never throws on Slack failures — a rejected invite is
 * recorded per-channel so the caller can surface it. A DB failure (tree /
 * membership / channel load) does throw, so the caller returns a 5xx.
 */
export async function backfillTeamSlack(
  deps: { db: SupabaseClient; slack?: SlackDeps; sleep?: (ms: number) => Promise<void> },
  teamId: string,
): Promise<TeamSlackBackfillSummary> {
  const db = deps.db;
  const slack = deps.slack ?? slackDepsFromEnv();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const slackConfigured = Boolean(slack.token) && slack.isProd;

  const { effectiveActive, withSlack, withoutSlackCount } = await computeEffectiveSlackMembers(db, teamId);

  const { data: channelData, error: channelError } = await db
    .from("team_slack_channel")
    .select("slack_channel_id, label")
    .eq("team_id", teamId)
    .order("slack_channel_id");
  if (channelError) throw new Error(channelError.message);
  const channels = (channelData ?? []) as { slack_channel_id: string; label: string | null }[];

  const results: ChannelBackfillResult[] = [];
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const result: ChannelBackfillResult = {
      channelId: ch.slack_channel_id,
      label: ch.label,
      invited: 0,
      alreadyIn: 0,
      skippedNoSlack: withoutSlackCount,
      failed: 0,
    };

    // Nothing to invite, or Slack not wired up here: report the channel with
    // zero activity rather than making pointless API calls.
    if (!slackConfigured || withSlack.length === 0) {
      results.push(result);
      continue;
    }

    const read = await listChannelMembers(slack, ch.slack_channel_id);
    if (read.ok) {
      // We know the current membership, so invite only the genuinely-missing
      // and report the exact already-in / invited split.
      const missing = withSlack.filter((t) => !read.members.includes(t.slackUserId));
      result.alreadyIn = withSlack.length - missing.length;
      if (missing.length > 0) {
        applyInvite(result, await inviteToChannelDetailed(slack, ch.slack_channel_id, missing.map((t) => t.slackUserId)), missing.length);
      }
    } else {
      // Couldn't read current membership: fall back to inviting everyone
      // (already_in_channel is folded into invite success), but flag it so the
      // report shows `invited` as an upper bound with already-in unknown rather
      // than claiming a precise split the read couldn't support.
      result.membersReadFailed = true;
      applyInvite(result, await inviteToChannelDetailed(slack, ch.slack_channel_id, withSlack.map((t) => t.slackUserId)), withSlack.length);
    }
    results.push(result);
    // ~1 req/sec between channels (mirrors the event sweep); no trailing sleep
    // after the final channel.
    if (i < channels.length - 1) await sleep(1100);
  }

  return {
    effectiveActive,
    withSlackCount: withSlack.length,
    withoutSlackCount,
    slackConfigured,
    channels: results,
  };
}
