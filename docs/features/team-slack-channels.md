# Team Slack channel auto-invites

When a person joins a team (admin add, self-service join, or approved application), they are automatically invited to every Slack channel linked to that team. A team can be linked to many Slack channels, and a single Slack channel can be linked to many teams — many-to-many. Setup/config: [Slack setup](../setup/slack.md).

Joining a team also invites the person to every Slack channel linked to that team's **ancestor**
teams (umbrella channels) — teams form a tree (`team.parent_team_id`), and joining `FRC Students`
invites them to `#frc-all` if that channel is linked to the parent `FRC` team. Slack has no
reconcile, so this join-time invite is the only mechanism that fills an umbrella channel.

## How it works

When a membership change occurs — a person is added to a team via the admin UI, self-joins a team, or an application is approved — the system invokes `syncSlackMembershipChange()` from `src/lib/slack-channel-sync.ts` via the shared fan-out helper `syncMembershipChange` in `src/lib/membership-sync.ts` (which also runs the Google Group and GitHub Team syncs). For each linked Slack channel:

1. Resolves the person's Slack identity via their stored `person.slack_user_id` (populated by the [Slack link sync](slack-integration.md)).
2. If the person has no linked Slack account, the invite is skipped and logged as "no slack_user_id" — not surfaced as an error.
3. Calls Slack's `conversations.invite` API to add the person to the channel, passing the channel ID (e.g. `C0123ABC`) and the Slack user ID.
4. If Slack returns `already_in_channel`, counts it as success (idempotent).
5. If Slack returns `not_in_channel`, the invite fails — this means the bot is not a member of the channel and cannot invite anyone; this is logged and does **not** block the membership change.
6. Any other Slack error is logged; the membership change still succeeds.
7. A failed invite (e.g. `not_in_channel`, `channel_not_found`) posts a one-line alert to `#hub-admin-alerts` naming the person, team, and channel so an admin can invite the bot to the channel or fix its ID; skipped invites (no bot token, non-prod, or a person with no linked Slack account) do not alert.

## Linking channels to teams

**Admin → Teams → [Team] → Slack channels** shows a repeatable list of linked channels. Each entry is a Slack channel ID (e.g. `C0123ABC`) with an optional label for display. The data is stored in the `team_slack_channel` join table.

Admins manage links directly in the team edit form — no separate sync page. Adding a channel link takes effect immediately for new memberships; removing a link has no retroactive effect (people already invited remain).

## Prerequisites

- **`SLACK_BOT_TOKEN` must be set in the environment** (this env var already exists in prod for other Slack features). Unset ⇒ the feature silently no-ops.
- **The bot must already be a member of each linked channel**, or Slack's `conversations.invite` returns `not_in_channel`. This is a manual operational step when linking a channel: an admin must add the bot to the channel first.
- **Bot scopes**: `channels:manage` (for public channels — already granted for the event Slack channels feature) and `groups:write` (for private channels).

## Limitations

- **Add-only**: invites never remove anyone. Unlinking a channel from a team does not kick existing members.
- **Best-effort**: a Slack API failure is logged and never blocks the membership change in the hub.
- **No *instant* backfill**: linking a channel to a team with existing members does not retroactively invite them; only new membership changes trigger invites going forward. This also applies to umbrella channels — linking a new channel to a parent team, or re-parenting a team under it, does not retroactively invite existing sub-team members. The **[Invite all effective members](#invite-all-effective-members-backfill)** admin action (below) covers both cases on demand (#264). A nightly `slack-nightly-sync` cron also backfills every linked channel automatically (see below), so an admin only needs the button when they don't want to wait for the next night.
- **No workspace auto-add**: the feature assumes people have already linked their Slack account to the hub. If a person has no `slack_user_id`, no invite happens; they must link their Slack account first via the Slack link sync.
- **Idempotent**: calling `conversations.invite` with a user already in the channel succeeds; a second membership change to the same person does not error.

## Invite all effective members (backfill)

The join-time invite fills a channel only when someone joins, and the nightly `slack-nightly-sync`
cron (below) reconciles every linked channel once a day. The **Invite all effective members** button
on **Admin → Teams → [Team]** closes the gap *on demand* — for when an admin doesn't want to wait
for the next nightly run after a structural change (linking a channel, or re-parenting a team).

The action does two things for the team, in one click (guarded by a confirm dialog that shows the
invite count first):

1. **Slack backfill.** Computes the team's *effective* membership — every active person who is a
   member of the team or any descendant (its subtree), deduped by person — and invites those with a
   linked Slack account to every channel linked directly to the team. It reads each channel's
   current membership first, so people already in are reported as "already in" and only the
   genuinely-missing are invited. People with no `slack_user_id` are counted as skipped. This is
   still **add-only** and never removes anyone.
2. **On-demand Drive + GitHub reconcile.** Runs the same whole-graph, idempotent reconcile the
   nightly cron runs, so a re-parenting propagates to Google Groups and GitHub Teams immediately
   instead of waiting overnight. It is whole-graph on purpose: a re-parent changes an *ancestor's*
   effective membership, so reconciling only the one team would miss exactly the group/team that
   needs updating.

After firing, the page reports a per-channel summary (invited / already-in / skipped / failed) plus
the Drive and GitHub reconcile results. The action is a `POST` (`/api/admin/teams/[id]/backfill`,
admin-only) — never a state-changing `GET`, per the `sameSite=lax` CSRF rule.

## Nightly reconcile (`slack-nightly-sync`)

A pg_cron job runs one unattended Slack reconcile each night at `40 7 * * *` (UTC), 20 minutes
after the GitHub team sync so no two heavy syncs overlap. It posts to
`/api/cron/slack/membership-sync`, guarded by the `slack_sync_secret` shared secret (constant-time
compare; unset ⇒ 403, so prod must set it — it is deliberately not seeded). The job does two things
in sequence, so newly-linked people are invited the same night:

1. **Identity link sync** — refreshes `person.slack_user_id` from Slack membership (the same
   `syncSlackLinks` behind the manual **Sync now** button).
2. **Channel-membership reconcile** — for every team with a linked Slack channel, invites its
   effective (subtree) members. **Add-only**: it invites the missing and only *reports* a
   `wouldRemove` count for hub-linked channel members who are no longer effective members — it
   never kicks anyone.

The schedule is visible and editable at **Admin → Cron**. Migration:
`supabase/migrations/20260909120000_slack_nightly_sync_cron.sql`.

## Source

`src/lib/slack-channel-sync.ts` (`syncSlackMembershipChange` — the add-only per-membership invite, fully unit-tested with fake fetch/db), `src/lib/membership-sync.ts` (fan-out that also runs the Google/GitHub syncs), `src/lib/slack-channels.ts` (`inviteToChannel`, the Slack `conversations.invite` call), `src/lib/teams.ts` (`parseTeamInput`/`createTeam`/`updateTeam` write the `team_slack_channel` join rows).

Backfill action: `src/lib/team-slack-backfill.ts` (`computeEffectiveSlackMembers` + `backfillTeamSlack`), `src/lib/slack-channels.ts` (`listChannelMembers`, the paginated `conversations.members` read used to skip already-in members), `src/app/api/admin/teams/[id]/backfill/route.ts` (the admin `POST` handler that also triggers the Drive/GitHub reconcile), `src/components/InviteAllMembersButton.tsx` (the button + results UI).
