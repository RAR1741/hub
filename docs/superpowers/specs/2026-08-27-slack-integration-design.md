# Slack Integration — Design

**Date:** 2026-08-27
**Issues:** #80 (umbrella), #191 (weekly mentor reminders), #194/#195/#196 (sync-failure admin alerts)
**Status:** Approved design, pre-implementation

## Overview

Give the hub the ability to send Slack messages — to public channels, private
channels, and users via DM — and link hub people to their Slack accounts. All
concrete needs today (#191, #194, #195, #196) are **outbound-only**, so phase 1
ships no Slack-facing inbound endpoints (no slash commands, no events, no
signature verification). Inbound is phase 2.

## Goals

- Typed, human-readable sending API: `postChannelMessage("hub-admin-alerts", ...)`
  where a misspelled channel name is a compile error.
- Admin alerts to a private channel when FIRST sync, Google Calendar sync, or
  Drive group sync fails (#194/#195/#196) — on state *transition*, not per
  failure.
- Weekly DM to each mentor with incomplete FIRST requirements (#191).
- Link `person` rows to Slack user IDs: automatic email match + manual admin
  fallback.
- Safe-by-construction local dev: non-production sends physically cannot reach
  real channels or DMs.

## Non-goals (phase 2 or later)

- Slash commands, buttons, events (inbound surface: signing-secret
  verification, 3-second ack via `waitUntil`, `response_url`).
- Automatic workspace invites. `admin.users.invite` is Enterprise Grid-only;
  the workspace is Pro. v2 fallback: store a standing workspace invite link in
  `app_setting` and auto-email it (Gmail sending exists) when a person is added
  to the hub; the next link-sync picks them up after they join.
- File uploads (`files.*`) — no current issue needs them.

## Slack app setup (manual, one-time)

Two Slack apps in the team's real workspace, defined by one checked-in
manifest (`slack/manifest.yml`) applied twice:

| App | Used by | Reach |
| --- | --- | --- |
| **hub** | production | Invited to the private alerts channel; DMs anyone |
| **hub-dev** | local dev / previews | Only ever invited to `#bot-test` |

Not an OAuth-distributed app: single workspace, installed once, permanent bot
token. Bot-token scopes: `chat:write`, `chat:write.public`, `im:write`,
`users:read`, `users:read.email`. (Exact scope names verified against Slack
docs at implementation time.)

Because both apps live in the same workspace, channel IDs are identical across
environments — which is what lets the channel registry be checked-in code.

## Configuration

| Where | Key | What |
| --- | --- | --- |
| Env var (Vercel env / worktree `.env`) | `SLACK_BOT_TOKEN` | Secret. Prod token in Vercel production env; dev token locally/preview. Unset ⇒ sends are logged no-ops. |
| Code (`src/lib/slack-registry.ts`) | `CHANNELS`, `TEAMS` | Typed registries (below). Adding a channel = one-line code change + deploy. |
| `app_setting` | `slack_alert_state_*` | Last-known ok/failing per alert source. |
| `app_setting` | `slack_reminder_secret` | Auth for the weekly-reminder cron endpoint (first-sync pattern). |
| `app_setting` (v2) | `slack_invite_link` | Standing workspace invite link. |

## Registries — `src/lib/slack-registry.ts`

```ts
export const CHANNELS = {
  bot_test: "C0XXXXXXX",   // #bot-test — all non-prod sends land here
  "hub-admin-alerts": "C0YYYYYYY", // private admin alerts channel
} as const;
export type ChannelName = keyof typeof CHANNELS;

// Usergroup mentions ("@mentors") — "<!subteam^ID>" format.
// IDs from https://app.slack.com/client/<team>/browse-user-groups
export const TEAMS = {
  mentors: "<!subteam^S0ZZZZZZZ>",
} as const;
export type TeamName = keyof typeof TEAMS;
```

Real IDs are filled in during implementation from the workspace.

## Sending library — `src/lib/slack.ts`

Plain `fetch` against `https://slack.com/api/` (no SDK dependency — two
endpoints). Exposed API:

```ts
postChannelMessage(channel: ChannelName, text: string): Promise<void>
sendDM(slackUserId: string, text: string): Promise<void>   // conversations.open → chat.postMessage
sendAdminAlert(text: string): Promise<void>                // → hub-admin-alerts
mention(team: TeamName): string                            // interpolate into text
```

Behavior rules, enforced inside the lib so no caller can bypass them:

1. **No token configured** → every send is a logged no-op. Tests, CI, and
   fresh checkouts need zero Slack setup.
2. **`VERCEL_ENV !== "production"`** (unforgeable gate — see
   docs/dev-notes on dev-route gating) → every send is redirected to
   `bot_test`, prefixed with its intended destination and an environment
   preface, e.g. `[dev → DM @jordan]: ...`. Non-prod cannot reach real
   channels or DMs even with a prod token pasted in by mistake.
3. Sends **never throw** into caller flows by default — a Slack outage must
   not break a sync. Failures are logged; callers that need to know get a
   boolean result.
4. DM loops are paced (~1/sec) to respect `chat.postMessage` rate limits. No
   `conversations.close` after DMs (worst rate limit in the API for zero
   benefit).

## Admin alerts on sync failure (#194, #195, #196)

Call sites: FIRST sync (`src/lib/first-sync.ts` / its route), calendar sync
route, drive-group sync route. Each wraps its outcome in:

```ts
reportSyncOutcome(source: "first_sync" | "calendar_sync" | "drive_sync", ok: boolean, error?: string)
```

which compares against `app_setting.slack_alert_state_<source>` and alerts
**only on transition**: `ok → failing` posts the error to `hub-admin-alerts`;
`failing → ok` posts a recovery note. Rationale: first-sync runs every 15
minutes; per-failure alerting would post ~96 messages/day during a persistent
outage. The expired-FIRST-session case (#190/#194) reports as a failure like
any other.

## User linking (v1: read + match)

- **Migration:** `person.slack_user_id text unique null`.
- **Sync:** admin-triggered endpoint (button on the admin UI) pulls
  `users.list`, filters out deleted/bot/unconfirmed/restricted accounts,
  matches profile email case-insensitively against `person.email` **and**
  `person_identity.email`, and writes `slack_user_id` on unambiguous matches.
  Slack is queried live when needed — no mirror table.
- **Manual fallback (admin UI):** Slack emails are often personal addresses
  that match nothing. An admin page section lists unlinked people alongside
  unmatched Slack users with link/unlink controls; the person admin page shows
  the current link. (`person_identity` already supports multiple emails per
  person — adding someone's personal email there also fixes auto-match.)

## Weekly mentor reminders (#191)

Reuses the first-sync cron pattern exactly: migration schedules pg_cron weekly
→ `net.http_post` to `/api/cron/slack/mentor-reminders`, authenticated by an
`x-sync-secret`-style header matched against `app_setting.slack_reminder_secret`.

The endpoint:

1. Finds mentors with ≥1 incomplete FIRST requirement, read from the columns
   the FIRST sync already maintains on `person`: `first_consent_release`
   (boolean) and `first_training_status` (text). Which `first_training_status`
   values count as "complete" (and whether YPP is distinguishable within it)
   is pinned down during implementation from real synced data.
2. DMs each **linked** mentor their specific outstanding items, paced ~1/sec.
3. Posts one summary to `hub-admin-alerts`: how many reminded, and **by name who
   could not be DMed because they're unlinked**. Unlinked ≠ silently skipped.

Fully-complete mentors get nothing. Day/time is set in the cron expression
(default: Monday morning; trivially changeable by migration).

## Error handling summary

- Slack down / token revoked → sends no-op with logs; syncs unaffected;
  reminder cron's summary post failing is logged, not retried.
- `users.list` pagination and 429s handled in the sync endpoint (single
  retry-after honor, then give up and report).
- Ambiguous email match (one email, two people) → skip + include in the sync
  result for manual resolution.

## Testing

- Unit tests (`src/lib/slack.test.ts` etc.) with mocked `fetch`: registry
  typing, redirect rule, no-token no-op, transition-based alerting, email
  matching (case, `person_identity`, restricted-account filtering, ambiguity).
- E2E: admin link UI flows against the dev-login roles; no live Slack calls
  (no token in CI ⇒ no-op path, which is itself asserted).
- Manual: from this worktree with the dev app's token, verify a real message
  lands in `#bot-test` with the redirect preface.

## Delivery order (each its own PR)

1. **Slack core:** registry + `slack.ts` + env plumbing + transition-based
   admin alerts wired into the three syncs (#194/#195/#196).
2. **Linking:** migration + users.list sync + admin UI (#80 v1 linking).
3. **Reminders:** weekly cron + endpoint (#191).

Phase 2 (separate design when needed): slash commands/interactivity, invite
link automation (v2 joining flow).
