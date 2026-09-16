-- Weekly "What's new in the hub" Slack digest via pg_net → the app endpoint.
-- Reuses slack_reminder_secret (same trust boundary as the mentor-reminder cron);
-- only the URL is new because it differs per route. URL read from app_setting
-- AT RUN TIME — seeded to the dev default, MUST be set per-env in prod.
insert into app_setting (key, value) values
  ('whats_new_url', '"http://host.docker.internal:3000/api/cron/slack/whats-new"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'slack-whats-new-weekly',
  '0 13 * * 1',  -- Mondays 13:00 UTC = 9:00am EDT (8:00am EST after DST ends; pg_cron runs in UTC)
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'whats_new_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'slack_reminder_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
