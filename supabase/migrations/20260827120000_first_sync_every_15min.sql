-- Reschedule FIRST roster sync from nightly to every 15 minutes.
--
-- The FIRST session cookie has a sliding expiration: it renews on each API call.
-- By syncing every 15 minutes (instead of once nightly), we keep the session warm
-- between syncs and avoid cookie expiry mid-day. The sync endpoint now persists
-- rotated cookies, so frequent runs maintain session continuity. As a bonus,
-- dashboard data stays fresher and session expiry surfaces within 15 minutes if
-- the FIRST session does expire.
--
-- This migration unschedules the old 'first-nightly-sync' job (if present) and
-- schedules the new 'first-roster-sync' job with the same endpoint logic but a
-- new schedule and job name.
create extension if not exists pg_net;

-- Safely unschedule the old job if it exists
do $$
begin
  if exists (select 1 from cron.job where jobname = 'first-nightly-sync') then
    perform cron.unschedule('first-nightly-sync');
  end if;
end $$;

-- Safely unschedule the new job if it already exists (re-run safety)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'first-roster-sync') then
    perform cron.unschedule('first-roster-sync');
  end if;
end $$;

-- Schedule the new every-15-minute job
select cron.schedule(
  'first-roster-sync',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'first_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'first_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
