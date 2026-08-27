-- Weekly mentor FIRST-requirement reminders via pg_net → the app endpoint.
-- URL + secret read from app_setting AT RUN TIME (set per-env; empty secret
-- never authorizes). Same pattern as first-nightly-sync / drive-group sync.
insert into app_setting (key, value) values
  ('slack_reminder_secret', '""'),
  ('slack_reminder_url', '"http://host.docker.internal:3000/api/cron/slack/mentor-reminders"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'slack-mentor-reminders-weekly',
  '0 14 * * 1',  -- Mondays 14:00 UTC ≈ 9-10am team-local (America/Indiana)
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'slack_reminder_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'slack_reminder_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
