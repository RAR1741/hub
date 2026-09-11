# Sync run history

Every integration sync — FIRST roster, Google Calendar, Drive groups, GitHub teams, Slack membership — records one row in the sync history table. **Admin → Sync runs** (`/admin/sync-runs`) shows an audit trail with manual **Run now** buttons per source, filters by source/status/date range (via URL-shareable query params), and a 90-day rolling retention.

## What gets tracked

One row per sync run:
- **Source**: which integration (FIRST roster, Google Calendar, Drive groups, GitHub teams, Slack membership).
- **Status**: ok (succeeded) or failed.
- **Duration**: calculated from `finished_at - started_at` and displayed as `1.2s` / `2m 05s`.
- **Finished time**: when the sync completed, shown in the team's configured timezone.
- **Changes**: a flat dict of counts per source (e.g., `meetings 12 · buildDays 3` from Calendar, or `groups 2 · added 5 · errors 1` from Drive). On failure, this is null.
- **Error**: only on failure — full stack trace if available, else the error message. Truncated to 8000 characters. Visible in the table with the first line shown and full text expandable via `<details>`.

## Filtering & sharing

Filters appear as query params in the URL, so a filtered view is shareable:
- `?source=first_sync` — show only FIRST sync runs.
- `?ok=true` / `?ok=false` — show only successes or only failures.
- `?from=2025-09-01&to=2025-09-10` — show runs within a date range (in UTC).
- Combine multiple filters: `?source=slack_sync&ok=false&from=2025-09-01` shows failed Slack syncs since Sept 1.

A Slack alert that fires when a sync transitions to failing includes a deep link: `<HUB_URL/admin/sync-runs?source=<source>|View run history>`. Clicking it takes an admin straight to that source's history.

## Run now

Each source has a **Run now** button that POSTs to its existing sync route. The button is disabled while a sync runs (syncs can take minutes, especially GitHub/Slack at scale); on completion it refreshes the page and shows the new run as the top row. An error response (bad credentials, already-running, etc.) displays inline under the button.

## Retention

Rows older than 90 days are pruned nightly by the existing `close_stale_sessions()` cron job (runs at 08:00 UTC regardless of whether auto-close is enabled), so the table stays manageable — roughly 10k rows at 90-day retention given FIRST syncing every 15 minutes.

## How it works

Every sync already reports through one seam: `reportSyncOutcome()` in `src/lib/slack-alerts.ts`. Before posting a Slack alert, it now inserts a row into `sync_run` with the source, ok/failed status, start/finish times, per-source counts, and on failure the error stack. The insert is in its own try/catch ahead of the alert, so a database write failure never suppresses a Slack alert — the admin always finds out about a sync issue even if recording it fails.
