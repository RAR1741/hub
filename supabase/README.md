# Supabase local dev — script flags, don't remove

The `db:*` scripts in `package.json` run the Supabase CLI *inside the dev container*.
The CLI's own defaults assume it's running directly on the Docker host, so a couple of
flags are required here that would otherwise look unnecessary. Please keep them.

- **`db:start` uses `--ignore-health-check`.** Without it, `supabase start` fails after
  all containers are already healthy, because its post-start check hits
  `http://127.0.0.1:54321/...` to confirm readiness — and `127.0.0.1` from inside the
  dev container is the container's own loopback, not the host's published ports. The
  services are genuinely up; the CLI just can't verify it from here.

- **`db:reset` uses an explicit `--db-url postgresql://postgres:postgres@host.docker.internal:54322/postgres?sslmode=disable`.**
  Plain `supabase db reset` fails immediately with `ECONNREFUSED 127.0.0.1:54322` for
  the same reason. `host.docker.internal` is how the dev container reaches sibling
  containers on the host; `sslmode=disable` is required because local Postgres doesn't
  speak TLS. The `postgres:postgres` credential is the well-known Supabase **local-only**
  dev default — never point this URL at a real or hosted database.

- **Caveat:** because `--db-url` routes through the CLI's remote-reset code path, this
  `db:reset` does a schema drop/reapply (migrations + seed) against the running
  database, not the CLI's full local-teardown behavior (it won't recreate volumes or
  restart the `auth`/`storage` containers). That's sufficient for this project, but
  don't assume it's identical to a bare `supabase db reset` on a host machine.

See `.superpowers/sdd/2026-08-10-m1-foundation-auth/task-2-report.md` for the full
investigation and verification output.

## Nightly session sweep

`close_stale_sessions()` (see `supabase/migrations/20260811071555_session_sweep.sql`)
heals forgotten sign-outs: any `session` row still open (`time_out is null`) from a
**previous local day** gets backdated to `time_in + auto_close_hours` and stamped
with `edited_at = now()`. `edited_by` is deliberately left `NULL` — that's the signal
the flagged-sessions screen uses to distinguish an auto-close from a human edit.

The function is timezone-aware: it reads `team_timezone` (default
`America/Indiana/Indianapolis`) and `auto_close_hours` (default `4`) from
`app_setting`, and computes "start of today" in that timezone before comparing
against each session's `time_in`. A session opened earlier today is left alone even
if it's been open for hours; only sessions from a prior calendar day (in team-local
time) are swept.

It's scheduled via `pg_cron` to run once daily at **08:00 UTC** (job name
`close-stale-sessions`) — early morning across all US timezones the team is likely
to be in, well after the shop has closed. The UTC hour doesn't need to be exact;
the function itself does the local-day math.

For manual runs — "close everyone out now" or testing without waiting for cron —
call `POST /api/admin/sessions/run-sweep` (mentor role or higher). It invokes the
same function via `getDb().rpc("close_stale_sessions")` and returns
`{ closed: <count> }`.

## Hourly calendar sync

`supabase/migrations/20260811084653_calendar_cron.sql` schedules a `pg_cron` job
(`gcal-hourly-sync`) that runs once an hour (`0 * * * *`) and uses `pg_net`'s
`net.http_post` to call `POST /api/admin/calendar/sync`. Both the target URL
(`app_setting.sync_url`) and the shared secret (`app_setting.gcal_sync_secret`,
sent as the `x-sync-secret` header) are read from `app_setting` **at run time** via
sub-selects in the cron command — changing either value (e.g. to point at the
production URL) needs no new migration.

The sync endpoint itself is a no-op that returns `not_configured` until the Google
service account is set up (see `docs/setup/google-calendar.md`). On the hosted
project, `sync_url` must be updated to the production URL and `gcal_sync_secret`
must be set to a non-empty value as part of the deploy runbook (see
`docs/setup/deploy.md`) — otherwise the cron job will fire hourly against the
local placeholder URL with an empty secret.
