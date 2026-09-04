# Team Slack channel auto-invites

When a person joins a team (admin add, self-service join, or approved application), they are automatically invited to every Slack channel linked to that team. A team can be linked to many Slack channels, and a single Slack channel can be linked to many teams — many-to-many. Setup/config: [Slack setup](../setup/slack.md).

## How it works

When a membership change occurs — a person is added to a team via the admin UI, self-joins a team, or an application is approved — the system invokes `syncSlackMembershipChange()` from `src/lib/slack-channel-sync.ts` via the shared fan-out helper `syncMembershipChange` in `src/lib/membership-sync.ts` (which also runs the Google Group and GitHub Team syncs). For each linked Slack channel:

1. Resolves the person's Slack identity via their stored `person.slack_user_id` (populated by the [Slack link sync](slack-integration.md)).
2. If the person has no linked Slack account, the invite is skipped and logged as "no slack_user_id" — not surfaced as an error.
3. Calls Slack's `conversations.invite` API to add the person to the channel, passing the channel ID (e.g. `C0123ABC`) and the Slack user ID.
4. If Slack returns `already_in_channel`, counts it as success (idempotent).
5. If Slack returns `not_in_channel`, the invite fails — this means the bot is not a member of the channel and cannot invite anyone; this is logged and does **not** block the membership change.
6. Any other Slack error is logged; the membership change still succeeds.

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
- **No backfill**: linking a channel to a team with existing members does not retroactively invite them; only new membership changes trigger invites going forward.
- **No workspace auto-add**: the feature assumes people have already linked their Slack account to the hub. If a person has no `slack_user_id`, no invite happens; they must link their Slack account first via the Slack link sync.
- **Idempotent**: calling `conversations.invite` with a user already in the channel succeeds; a second membership change to the same person does not error.

## Source

`src/lib/slack-channel-sync.ts` (`syncSlackMembershipChange` — the add-only per-membership invite, fully unit-tested with fake fetch/db), `src/lib/membership-sync.ts` (fan-out that also runs the Google/GitHub syncs), `src/lib/slack-channels.ts` (`inviteToChannel`, the Slack `conversations.invite` call), `src/lib/teams.ts` (`parseTeamInput`/`createTeam`/`updateTeam` write the `team_slack_channel` join rows).
