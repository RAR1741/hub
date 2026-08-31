-- Per-event Slack channels: columns to track the channel + invite state, plus
-- a nightly pg_net → app endpoint job that creates/archives channels and
-- invites signups. URL + secret read from app_setting AT RUN TIME (set
-- per-env; empty secret never authorizes). Same pattern as
-- slack-mentor-reminders-weekly.
-- event and event_signup are already granted to service_role; new columns
-- need no grant.
alter table event add column slack_channel_id text unique;
alter table event add column slack_channel_name text;
alter table event add column slack_archived_at timestamptz;

alter table event_signup add column slack_invited_at timestamptz;

insert into app_setting (key, value) values
  ('slack_event_channels_secret', '""'),
  ('slack_event_channels_url', '"http://host.docker.internal:3000/api/cron/slack/event-channels"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'slack-event-channels-nightly',
  '0 8 * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'slack_event_channels_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'slack_event_channels_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
