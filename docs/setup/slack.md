# Setting up the Slack integration

The hub sends Slack messages — admin alerts when a sync fails (#194/#195/#196), weekly DM
reminders to mentors with outstanding FIRST requirements (#191), and links `person` rows to
Slack users (#80). All of it is **outbound-only**; there is no inbound Slack surface (no slash
commands or events).

Code lives in `src/lib/slack.ts` (sending), `src/lib/slack-registry.ts` (channel IDs),
`src/lib/slack-alerts.ts` (transition alerts), `src/lib/slack-link.ts` (email→Slack linking),
and `src/lib/mentor-reminders.ts` (weekly reminders).

## How it works (read this first)

- **One app per environment, one bot token.** Not an OAuth-distributed app — a single-workspace
  app installed once, with a permanent bot token (`xoxb-…`) in the `SLACK_BOT_TOKEN` env var.
  Two apps share one workspace: **`hub`** (production) and **`hub-dev`** (local/preview).
- **Non-production can't reach real channels or DMs.** The gate is `VERCEL_ENV === "production"`
  (reserved/unforgeable). Anywhere else — local, preview, unset — every send is redirected to
  `#bot-test` with a `[dev → #channel]` / `[dev → DM <user>]` preface, even if a prod token is
  pasted in by mistake.
- **No token ⇒ logged no-op.** A checkout with no `SLACK_BOT_TOKEN` never errors; sends just log
  and return `false`. Tests and CI need zero Slack setup.
- **Sends never throw.** A Slack outage can't break a sync or the reminder cron.
- **Channel IDs live in code**, not config — the workspace is the same across environments, so the
  IDs are identical everywhere (`src/lib/slack-registry.ts`). A misspelled channel name is a
  compile error. Secrets (`SLACK_BOT_TOKEN`) live only in env vars.

## Channels and scopes

| Registry key | Slack channel | Used for |
| --- | --- | --- |
| `bot_test` | `#bot-test` | Every non-prod send lands here |
| `hub-admin-alerts` | `#hub-admin-alerts` | Admin alerts + reminder run summaries |

Bot-token scopes (both apps): `chat:write`, `chat:write.public`, `im:write`, `users:read`,
`users:read.email`.

## Configuration surface

| Where | Key | What |
| --- | --- | --- |
| Env var | `SLACK_BOT_TOKEN` | Bot token. Prod token in Vercel Production; dev token locally/Preview. Unset ⇒ no-op. |
| `app_setting` | `slack_reminder_url` | URL pg_cron POSTs to for the weekly run. **Seeded to a dev default — must be set per-env.** |
| `app_setting` | `slack_reminder_secret` | Shared secret the cron sends and the endpoint checks. **Seeded empty (no-op) — must be set in prod.** |
| `app_setting` | `slack_alert_state_<source>` | Last-known ok/failing per sync source. Managed automatically; don't touch. |

---

## Production setup

Do these in order. Steps 3–7 assume the token from steps 1–2 is set and the app is redeployed.

### 1. Create the prod Slack app

In the workspace, create the **`hub`** app (separate from `hub-dev`) with the bot scopes listed
above. Install it to the workspace and copy the **Bot User OAuth Token** (`xoxb-…`). In Slack,
invite the bot to the private alerts channel:

```
/invite @hub
```

in **#hub-admin-alerts**. (DMs and public-channel posts need no invite; a private channel does.)

### 2. Set the token in Vercel

Project → Settings → Environment Variables → add `SLACK_BOT_TOKEN` = the prod `xoxb-…`, scoped to
**Production**. Optionally set the **dev** token in the **Preview** scope so preview deploys
exercise Slack while still redirecting to `#bot-test`. **Redeploy** — env changes only take effect
on a new deployment.

### 3. Push the migrations to prod

There is no CI job that migrates prod, so this is manual (per `AGENTS.md`). Preview, then apply:

```bash
./dev supabase migration list --linked
./dev supabase db push
```

This adds `person.slack_user_id` and schedules the weekly cron. Without it, `/admin/slack` and the
reminder cron error.

### 4. Set the prod `app_setting` values

The cron migration seeds a **dev** URL and an **empty** secret on purpose, so override both. Run in
the **prod** Supabase SQL editor (replace the secret with a long random value; no `"` or `\`):

```sql
insert into app_setting (key, value) values
  ('slack_reminder_url', '"https://hub.redalert1741.org/api/cron/slack/mentor-reminders"'),
  ('slack_reminder_secret', '"REPLACE_WITH_A_LONG_RANDOM_SECRET"')
on conflict (key) do update set value = excluded.value;
```

The `value` column is `jsonb`, so keep the inner double-quotes exactly as shown.

### 5. Verify the schedule and settings

```sql
select jobname, schedule, active from cron.job where jobname = 'slack-mentor-reminders-weekly';
select key, value from app_setting where key in ('slack_reminder_url','slack_reminder_secret');
```

Expect `0 23 * * 4`, `active = t`, the prod URL, and your secret.

### 6. Smoke-test the live send

This posts a **real** message to `#hub-admin-alerts`:

```bash
curl -i -XPOST https://hub.redalert1741.org/api/cron/slack/mentor-reminders -H "x-sync-secret: YOUR_SECRET"
```

Expect `HTTP 200` + `{"reminded":…,"unlinked":[…],"complete":…,"failed":[]}` and a summary in the
channel. `403` ⇒ the header doesn't match `slack_reminder_secret`. `200` but no message ⇒ the
deploy has no `SLACK_BOT_TOKEN` (set it, redeploy) or the bot isn't in `#hub-admin-alerts`.

### 7. Link people

Go to **`/admin/slack`** → **Sync now** to auto-link mentors whose Slack email matches their hub
email (or a `person_identity` email). Use the per-person control on the person page for the rest.
No mentor is DMed until they're linked — until then the reminder run just names them under "No
Slack link".

---

## The schedule

The weekly reminder runs on `0 23 * * 4` — **Thursday 23:00 UTC = 6:00pm EST** (7:00pm EDT during
daylight saving; pg_cron runs in UTC and can't follow DST). To change it, edit a **new** migration
(never edit an applied one) or run `select cron.alter_job(...)` / re-`cron.schedule` with the same
job name.

## Admin alerts (#194/#195/#196)

No extra config beyond `SLACK_BOT_TOKEN` + the bot being in `#hub-admin-alerts`. The FIRST /
Calendar / Drive sync routes call `reportSyncOutcome(...)`, which posts to `#hub-admin-alerts`
**only on a health transition** (ok→failing or failing→ok), with last-known state in
`app_setting.slack_alert_state_<source>`. This avoids ~96 alerts/day from the 15-minute FIRST sync
during an outage. The state advances only once an alert is actually delivered, so an alert isn't
lost if the token is missing when the first failure happens.

## Local / dev testing

The `hub-dev` token in `.env` is enough; everything redirects to `#bot-test` (invite the dev bot
there once). Next.js loads `.env` at server start, so restart the dev server if you add the token
while it's running (`docker compose restart app`). Ports are per-worktree — from the host use this
worktree's `APP_PORT` (not 3000), inside the container it's always 3000.

- **Linking** (no message sent): log in as Admin → `/admin/slack` → **Sync now**.
- **Reminders** (posts to `#bot-test`): set `slack_reminder_secret` locally, then
  `./dev bash -lc 'curl -s -XPOST localhost:3000/api/cron/slack/mentor-reminders -H "x-sync-secret: <value>"'`.

## Troubleshooting

- **`200` but nothing posts** — token not loaded (restart/redeploy after setting it) or the bot
  isn't in the target channel.
- **`403` from the cron endpoint** — the `x-sync-secret` header doesn't match
  `app_setting.slack_reminder_secret`, or the secret is still empty.
- **`/admin/slack` errors** — migrations not pushed to prod (`person.slack_user_id` missing).
- **Cron never fires in prod** — `slack_reminder_url` still points at the dev default; set it to
  the prod URL (step 4).
- **`not_in_channel` in logs** — invite the bot to the channel.
