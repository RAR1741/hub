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
  /** Person ids behind `withoutSlackCount`, so a shared channel can union them without double-counting. */
  withoutSlack: string[];
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
  const withoutSlack: string[] = [];
  for (const p of byId.values()) {
    if (p.slack_user_id) {
      withSlack.push({ personId: p.id, slackUserId: p.slack_user_id, name: displayName(p) });
    } else {
      withoutSlack.push(p.id);
    }
  }
  withSlack.sort((a, b) => a.name.localeCompare(b.name));
  return { effectiveActive: byId.size, withSlack, withoutSlackCount: withoutSlack.length, withoutSlack };
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
  /**
   * Hub-managed channel members who are NOT effective members of the channel —
   * reported only, never removed (add-only reconcile, issue #272). Undefined
   * when membership couldn't be read or no `managedSlackIds` was provided.
   */
  wouldRemove?: number;
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
 * Reconcile one Slack channel against the effective members it should contain:
 * read its current membership, invite the genuinely-missing, and report the
 * hub-managed members who aren't expected (`wouldRemove`) — never removing
 * anyone. `targets` is the channel's whole expected set, which for a channel
 * linked to several teams is the union across those teams.
 */
async function reconcileChannel(
  slack: SlackDeps,
  channel: { channelId: string; label: string | null },
  targets: SlackTarget[],
  skippedNoSlack: number,
  managedSlackIds?: Set<string>,
): Promise<ChannelBackfillResult> {
  const result: ChannelBackfillResult = {
    channelId: channel.channelId,
    label: channel.label,
    invited: 0,
    alreadyIn: 0,
    skippedNoSlack,
    failed: 0,
  };

  // Nothing to invite, or Slack not wired up here: report the channel with
  // zero activity rather than making pointless API calls.
  if (!(slack.token && slack.isProd) || targets.length === 0) return result;

  const read = await listChannelMembers(slack, channel.channelId);
  if (read.ok) {
    // We know the current membership, so invite only the genuinely-missing
    // and report the exact already-in / invited split.
    const missing = targets.filter((t) => !read.members.includes(t.slackUserId));
    result.alreadyIn = targets.length - missing.length;
    if (missing.length > 0) {
      applyInvite(result, await inviteToChannelDetailed(slack, channel.channelId, missing.map((t) => t.slackUserId)), missing.length);
    }
    if (managedSlackIds) {
      const expected = new Set(targets.map((t) => t.slackUserId));
      result.wouldRemove = read.members.filter((m) => managedSlackIds.has(m) && !expected.has(m)).length;
    }
  } else {
    // Couldn't read current membership: fall back to inviting everyone
    // (already_in_channel is folded into invite success), but flag it so the
    // report shows `invited` as an upper bound with already-in unknown rather
    // than claiming a precise split the read couldn't support.
    result.membersReadFailed = true;
    applyInvite(result, await inviteToChannelDetailed(slack, channel.channelId, targets.map((t) => t.slackUserId)), targets.length);
  }
  return result;
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
  deps: { db: SupabaseClient; slack?: SlackDeps; sleep?: (ms: number) => Promise<void>; managedSlackIds?: Set<string> },
  teamId: string,
): Promise<TeamSlackBackfillSummary> {
  const db = deps.db;
  const slack = deps.slack ?? slackDepsFromEnv();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const slackConfigured = Boolean(slack.token) && slack.isProd;
  const managedSlackIds = deps.managedSlackIds;

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
    results.push(
      await reconcileChannel(
        slack,
        { channelId: ch.slack_channel_id, label: ch.label },
        withSlack,
        withoutSlackCount,
        managedSlackIds,
      ),
    );
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

/** One reconciled channel plus the teams whose links put it in scope. */
export type ChannelReconcileResult = ChannelBackfillResult & { teamIds: string[] };

export type AllTeamSlackReconcileSummary = {
  slackConfigured: boolean;
  teamsWithChannels: number;
  totals: { invited: number; alreadyIn: number; wouldRemove: number; failed: number; skippedNoSlack: number; channels: number };
  channels: ChannelReconcileResult[];
};

/**
 * Nightly cron entry point: reconcile every Slack channel that at least one
 * team links to. Grouped by CHANNEL, not by team — the schema allows one
 * channel linked to several teams (`team_slack_channel` PK is
 * `(team_id, slack_channel_id)`), and the questions this answers are all
 * channel-scoped: a shared channel is visited once, and its expected member
 * set is the union of the effective members of every team linking it, so
 * someone effective under one of those teams never shows up in `wouldRemove`.
 *
 * Same add-only guarantees as `backfillTeamSlack`; a DB failure propagates
 * (caller returns a 5xx).
 *
 * ponytail: 1.1s sleep between channels and no other throttling — fine for a
 * handful of channels, revisit if Slack ever rate-limits a nightly run.
 */
export async function reconcileAllTeamSlackChannels(
  deps: { db: SupabaseClient; slack?: SlackDeps; sleep?: (ms: number) => Promise<void> },
): Promise<AllTeamSlackReconcileSummary> {
  const db = deps.db;
  const slack = deps.slack ?? slackDepsFromEnv();

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // ponytail: built from currently-present person rows, so a hard-deleted
  // (not just deactivated) linked person drops out of managedSlackIds and
  // stops being tracked in wouldRemove. Deferred deliberately — tracking them
  // needs a ledger that survives the delete (see the follow-up to #291).
  const { data: personData, error: personError } = await db.from("person").select("slack_user_id");
  if (personError) throw new Error(personError.message);
  const managedSlackIds = new Set<string>(
    ((personData ?? []) as { slack_user_id: string | null }[]).map((p) => p.slack_user_id).filter((id): id is string => Boolean(id)),
  );

  // Every link row, grouped by channel. A channel linked to several teams
  // appears once, carrying all of them; the label is the first link's in
  // team_id order.
  const { data: linkData, error: linkError } = await db
    .from("team_slack_channel")
    .select("team_id, slack_channel_id, label")
    .order("slack_channel_id")
    .order("team_id");
  if (linkError) throw new Error(linkError.message);
  const links = (linkData ?? []) as { team_id: string; slack_channel_id: string; label: string | null }[];

  const byChannel = new Map<string, { label: string | null; teamIds: string[] }>();
  for (const link of links) {
    const entry = byChannel.get(link.slack_channel_id);
    if (entry) entry.teamIds.push(link.team_id);
    else byChannel.set(link.slack_channel_id, { label: link.label, teamIds: [link.team_id] });
  }

  // Effective membership per linking team, computed once even when that team
  // links several channels.
  const effectiveByTeam = new Map<string, EffectiveSlackMembers>();
  for (const teamId of [...new Set(links.map((l) => l.team_id))].sort()) {
    effectiveByTeam.set(teamId, await computeEffectiveSlackMembers(db, teamId));
  }

  const channels: ChannelReconcileResult[] = [];
  const entries = [...byChannel.entries()];
  for (let i = 0; i < entries.length; i++) {
    const [channelId, { label, teamIds }] = entries[i];
    // Union across the linking teams, deduped by person: someone effective
    // under two of them is one expected member, not two.
    const targets = new Map<string, SlackTarget>();
    const withoutSlack = new Set<string>();
    for (const teamId of teamIds) {
      const effective = effectiveByTeam.get(teamId);
      if (!effective) continue;
      for (const t of effective.withSlack) targets.set(t.slackUserId, t);
      for (const personId of effective.withoutSlack) withoutSlack.add(personId);
    }
    const union = [...targets.values()].sort((a, b) => a.name.localeCompare(b.name));
    const result = await reconcileChannel(slack, { channelId, label }, union, withoutSlack.size, managedSlackIds);
    channels.push({ ...result, teamIds });
    if (i < entries.length - 1) await sleep(1100);
  }

  const totals = { invited: 0, alreadyIn: 0, wouldRemove: 0, failed: 0, skippedNoSlack: 0, channels: channels.length };
  for (const ch of channels) {
    totals.invited += ch.invited;
    totals.alreadyIn += ch.alreadyIn;
    totals.wouldRemove += ch.wouldRemove ?? 0;
    totals.failed += ch.failed;
    totals.skippedNoSlack += ch.skippedNoSlack;
  }

  return {
    slackConfigured: Boolean(slack.token) && slack.isProd,
    teamsWithChannels: effectiveByTeam.size,
    totals,
    channels,
  };
}
