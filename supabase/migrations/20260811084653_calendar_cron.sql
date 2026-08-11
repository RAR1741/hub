-- Hourly Google Calendar sync via pg_net → the app's sync endpoint. The endpoint
-- authenticates cron by the x-sync-secret header (matched against app_setting
-- gcal_sync_secret). URL + secret are read from app_setting AT RUN TIME via
-- sub-selects, so changing them (e.g. to the production URL) needs no new migration.
--
-- Locally, sync_url points at the app on the host. Set it to the production URL on
-- the hosted project (see docs/setup/deploy.md).
insert into app_setting (key, value) values
  ('sync_url', '"http://host.docker.internal:3000/api/admin/calendar/sync"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'gcal-hourly-sync',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'gcal_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
