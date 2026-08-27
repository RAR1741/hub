-- Nightly FIRST roster sync via pg_net → the app's sync endpoint. The endpoint
-- authenticates cron by the x-sync-secret header (matched against app_setting
-- first_sync_secret). URL + secret are read from app_setting AT RUN TIME via
-- sub-selects, so changing them (e.g. to the production URL) needs no new migration.
--
-- first_sync_url / first_sync_secret are seeded by an earlier migration; this
-- migration only schedules the job.
create extension if not exists pg_net;

select cron.schedule(
  'first-nightly-sync',
  '0 8 * * *',
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
