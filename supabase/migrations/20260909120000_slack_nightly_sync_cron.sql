-- Nightly Slack membership reconcile via pg_net → the app endpoint. One job runs
-- both Slack reconciles in sequence (identity link sync, then per-team channel
-- backfill), so newly-linked people are invited to their channels the same night.
-- Add-only: invites missing members and only REPORTS would-be removals — it never
-- kicks anyone. URL + secret read from app_setting AT RUN TIME, mirroring the
-- Drive/GitHub nightly syncs.
insert into app_setting (key, value) values
  ('slack_sync_url', '"http://host.docker.internal:3000/api/cron/slack/membership-sync"')
on conflict (key) do nothing;
-- slack_sync_secret is deliberately NOT seeded: prod must set it or the cron 403s
-- (an empty secret authorizes nobody).

create extension if not exists pg_net;

select cron.schedule(
  'slack-nightly-sync',
  '40 7 * * *',  -- 20 min after github-team-nightly-sync (20 7 * * *); staggered so no two heavy syncs overlap
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'slack_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'slack_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
