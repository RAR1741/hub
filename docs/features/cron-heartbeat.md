# Cron heartbeat (detecting jobs that stop firing)

Every scheduled job is a pg_cron entry whose body is a single `net.http_post(...)` into an app
route. That post is asynchronous: pg_cron records the *statement* as `succeeded` the moment the
request is enqueued, whatever the endpoint later answers. So `/admin/cron`'s "last run" column stays
green for a job whose endpoint returns `403` on every single run — which is exactly what happens
when a job's `*_secret` row is unset in prod (the guard is before the handler's try block), or when
its `*_url` still points at the `host.docker.internal` dev default. Nothing else notices, because a
job that never fires produces no failure to report.

The heartbeat closes that gap: the **work** says it happened, not the scheduler.

## How it works

- Each cron handler calls `recordCronHeartbeat("<pg_cron job name>", db)` when its run completes,
  upserting `app_setting.cron_heartbeat_<jobname>` with the current timestamp.
  `close-stale-sessions` has no HTTP handler, so `close_stale_sessions()` writes its own row.
- On the dual-gated routes (`/api/admin/*/sync`, `/api/cron/slack/membership-sync`) the heartbeat is
  written **only on the shared-secret path**. An admin pressing "Sync now" must not refresh it, or a
  cron that has been 403ing for a month looks healthy.
- `list_cron_jobs()` joins the heartbeat in, so `/admin/cron` shows **last success** next to last
  run, with an **overdue** marker when the two disagree.
- `isCronStale()` (`src/lib/cron-heartbeat.ts`) derives the allowance from the job's own schedule —
  one period plus a quarter of one, at least 15 minutes. So the every-5-min sweep is overdue after
  ~20 min, hourly after 75 min, nightly after 30 h, weekly after ~8.75 days. One skipped or slow run
  never alerts.
- `checkCronHeartbeats()` runs at the end of the `push-reminders` job (every 5 minutes — the
  tightest schedule we have, so no watcher job of its own) and reports each active job through
  `reportSubsystemHealth("cron_<jobname>", …)`. Opted-in admins get one push per job on the
  ok→overdue and overdue→ok transitions; per-job keys mean a second job going overdue still alerts
  while the first is down.

The alert says only *that* a job hasn't succeeded since a given time, not why. The three causes —
403 on an unset secret, a `*_url` never overridden for prod, pg_net down or the job deactivated —
are told apart from the job's row in `/admin/cron`, which shows pg_cron's own `active` flag and last
run status beside the heartbeat.

## Limits

- The staleness sweep rides on `push-reminders`. If *that* job stops firing, its own row goes
  overdue on `/admin/cron`, but no push goes out — nothing can alert about its own death.
- `cronPeriodMs()` understands the schedule shapes we actually use (`*/N` minutes, `*/N` hours,
  fixed-minute hourly, daily, weekly). Anything else is treated as daily.
- Job names are listed in `CronJobName`. A job renamed in a migration without renaming it here reads
  as permanently overdue — loud rather than silently unmonitored.
- The migration seeds a heartbeat for every active job, so deploying this doesn't read as eleven
  dead jobs; each one gets a single period of grace to record a real heartbeat.
