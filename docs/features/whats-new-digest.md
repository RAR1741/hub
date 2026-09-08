# Weekly "What's new" Slack digest

Every Monday, `sendWhatsNewDigest()` (`src/lib/whats-new.ts`), run by `POST
/api/cron/slack/whats-new` (`src/app/api/cron/slack/whats-new/route.ts`, shared-secret gated on
`app_setting.slack_reminder_secret` — same as [mentor reminders](slack-integration.md)), lists PRs
merged to `master` in the trailing 7 days and posts them to `#hub-admin-alerts`. No LLM, no
persisted cursor — the digest is deterministic and stateless.

## What it posts

One GitHub call lists closed PRs against `master`; `merged_at` in the last 7 days keeps a PR,
everything else is dropped. Labelled PRs (see below) render first under a "Watch out for" section,
everything else under "What's new". An empty week posts nothing.

Rendered example, with a heads-up PR:

```
*What's new in the hub* (2026-08-31 – 2026-09-07)

:warning: *Watch out for*
• <https://github.com/RAR1741/hub/pull/264|Kiosk now signs students out after 12h> (#264, @dracco1993)

*What's new*
• <https://github.com/RAR1741/hub/pull/261|GitHub sync: allow inactive members> (#261, @dracco1993)
• <https://github.com/RAR1741/hub/pull/265|Umbrella team resource inheritance> (#265, @dracco1993)
```

Like every Slack send, non-production redirects to `#bot-test` with a `[dev → #hub-admin-alerts]`
prefix (see [Sending](slack-integration.md#sending)).

## The `heads-up` label convention

Apply the GitHub label `heads-up` to any PR whose change people should know about before it bites
them — a behavior change, a removed feature, a new required step. Labelled PRs get pulled into the
"Watch out for" section above everything else; matching is case-insensitive (`Heads-up` still
matches). This is the first label convention in the repo — the label has to exist in GitHub first
(created as a post-merge step for this feature). Until it's created, every PR just lands under
"What's new," which is harmless.

## Schedule

pg_cron job `slack-whats-new-weekly`, cron `0 13 * * 1` — Mondays 13:00 UTC. pg_cron runs in UTC,
so that's 9am EDT / 8am EST (drifts an hour across DST). Adjustable in `/admin/cron`.

## Window

Stateless: 7 days back from run time, filtered on `merged_at`. A run that fails or gets skipped
just drops that week's PRs — no catch-up on the next run. Accepted by design.

## Config

- `app_setting.whats_new_url` — the URL pg_cron POSTs to. Seeded to a dev default; **must be set
  per-env in prod** (`https://hub.redalert1741.org/api/cron/slack/whats-new`) or the job silently
  no-ops against `host.docker.internal` forever.
- Reuses the existing `app_setting.slack_reminder_secret` — no new secret.
- GitHub auth is optional: `RAR1741/hub` is public, so an App installation token is used when
  present (higher rate limit) and an anonymous call otherwise (60 req/h, plenty for one call a
  week). No GitHub App permission change is needed either way.

## Testing locally

With `slack_reminder_secret` set locally:

```
./dev bash -lc 'curl -s -XPOST localhost:3000/api/cron/slack/whats-new -H "x-sync-secret: <value>"'
```

Posts to `#bot-test` (or logs `[slack:no-token]` if no dev Slack token is configured), and returns
`{"posted":false,"count":0}` if nothing merged to `master` in the last 7 days.

## Observability gap

pg_cron's `net.http_post` reports success as a SQL statement even when the route itself returns
403 or 502 — so a broken digest still shows green in `/admin/cron`. The only real signal is a
missing Monday post. This is the same limitation the [mentor-reminder cron](slack-integration.md#weekly-mentor-reminders)
has.
