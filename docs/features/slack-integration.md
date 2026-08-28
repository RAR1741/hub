# Slack integration

The hub sends outbound Slack messages — nothing inbound. It links hub people to Slack accounts,
DMs mentors their outstanding FIRST requirements weekly, and posts admin alerts when a sync job's
health changes. Setup/config: [Slack setup](../setup/slack.md).

## Linking people to Slack

**Admin → Slack** (`/admin/slack`) matches hub people to Slack workspace members by email and
writes `person.slack_user_id`.

- **Bulk sync**: the page's **Sync now** control calls `POST /api/admin/slack/link-sync`
  (`src/app/api/admin/slack/link-sync/route.ts` → `syncSlackLinks()` in `src/lib/slack-link.ts`).
  It fetches all active, non-bot, confirmed-email Slack members (`fetchSlackMembers()`, paginated),
  then matches each by lowercased email against `person.email` and every `person_identity.email`.
  An email matching more than one hub person is reported as **ambiguous** and not written; an
  already-correct link is counted separately from a new one.
- **Manual per-person link/unlink**: `PUT` / `DELETE /api/admin/people/[id]/slack`
  (`src/app/api/admin/people/[id]/slack/route.ts`) sets or clears one person's `slack_user_id`
  directly — for people whose Slack email doesn't match their hub email. A `slackUserId` already
  claimed by another person returns `409 slack_id_taken`.

The page lists linked people and unlinked active mentors/admins so it's obvious who a reminder run
will miss.

## Weekly mentor reminders

`sendMentorReminders()` (`src/lib/mentor-reminders.ts`), run by `POST
/api/cron/slack/mentor-reminders` (`src/app/api/cron/slack/mentor-reminders/route.ts`, shared-secret
gated on `app_setting.slack_reminder_secret`):

1. Loads every active mentor/admin's FIRST fields (from [FIRST roster sync](first-roster-sync.md))
   and computes their outstanding items (`outstandingItems()`): consent not `true`, screening
   status not `"green"`, training status not `"green"`. Never synced (`first_people_id == null`)
   counts as incomplete on every item.
2. DMs each linked mentor with outstanding items their specific list (`buildReminderText()`),
   paced ~1 message/second to respect Slack rate limits.
3. Posts one summary to `#hub-admin-alerts` — how many were DMed, how many are fully complete, and
   by name: any mentor with outstanding items who has no Slack link (never DMed), and any DM that
   failed to send.

A pg_cron job (`slack-mentor-reminders-weekly`) runs this on `0 23 * * 4` — Thursdays 23:00 UTC
(6pm EST / 7pm EDT; pg_cron runs in UTC and doesn't follow daylight saving).

## Sync-failure alerts

`reportSyncOutcome()` (`src/lib/slack-alerts.ts`) posts to `#hub-admin-alerts` when the FIRST,
Google Calendar, or Google Drive-group sync jobs fail or recover — called from each sync route
(`api/admin/first/sync`, `api/admin/calendar/sync`, `api/admin/drive-group/sync`). It only posts on
a health **transition** (ok→failing or failing→ok), tracked per source in
`app_setting.slack_alert_state_<source>`, so an ongoing outage on the 15-minute FIRST sync doesn't
spam ~96 alerts/day. State only advances once the alert is actually delivered, so a failure during
an unconfigured-token window still gets reported once the token comes back.

## Sending

All sends go through `src/lib/slack.ts` (`postChannelMessage()`, `sendDM()`):

- **No `SLACK_BOT_TOKEN` ⇒ logged no-op**, returns `false` — never throws.
- **Non-production redirects everything to `#bot-test`**, prefixed with its intended destination
  (`[dev → #channel]` / `[dev → DM <user>]`), gated on the unforgeable `VERCEL_ENV === "production"`
  — so a prod token pasted into a preview/dev environment still can't reach a real channel or DM.
- Channel names are a fixed registry (`src/lib/slack-registry.ts`), not config — currently
  `bot_test` and `hub-admin-alerts`.
