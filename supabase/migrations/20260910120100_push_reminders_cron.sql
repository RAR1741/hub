-- 20260910120100_push_reminders_cron.sql
-- Every-5-min reminder sweep (events + meetings) replacing the hourly
-- push-meeting-reminder job. Reuses push_cron_secret.
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-meeting-reminder') then
    perform cron.unschedule('push-meeting-reminder');
  end if;
  if exists (select 1 from cron.job where jobname = 'push-reminders') then
    perform cron.unschedule('push-reminders');   -- re-run safety
  end if;
end $$;

-- Inherit the deployed host from the old URL so prod needs no manual step.
insert into app_setting (key, value)
select 'push_reminders_url',
       to_jsonb(replace(value #>> '{}', '/api/cron/push/meeting-reminder', '/api/cron/push/reminders'))
  from app_setting where key = 'push_meeting_reminder_url'
on conflict (key) do nothing;
-- Fresh DB fallback.
insert into app_setting (key, value) values
  ('push_reminders_url', '"http://host.docker.internal:3000/api/cron/push/reminders"')
on conflict (key) do nothing;
delete from app_setting where key = 'push_meeting_reminder_url';

select cron.schedule(
  'push-reminders',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'push_reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'push_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
