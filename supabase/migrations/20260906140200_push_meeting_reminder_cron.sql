-- 20260906140200_push_meeting_reminder_cron.sql
-- Hourly meeting-reminder sweep: the route reminds meetings starting within 3h
-- that haven't been reminded, and stamps reminder_pushed_at so each fires once.
insert into app_setting (key, value) values
  ('push_meeting_reminder_url', '"http://host.docker.internal:3000/api/cron/push/meeting-reminder"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'push-meeting-reminder',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'push_meeting_reminder_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'push_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
