-- Link a team to a Google Workspace Group: membership in the team mirrors
-- into the group (null = this team does not sync). Group emails are set by
-- an admin in the team edit UI, not seeded here.
alter table team add column if not exists google_group_email text;

-- Nightly Drive-group reconcile via pg_net → the app's sync endpoint, same
-- pattern as gcal-hourly-sync: URL + secret read from app_setting AT RUN
-- TIME. Reconcile ADDS missing members and only REPORTS would-be removals.
insert into app_setting (key, value) values
  ('drive_sync_url', '"http://host.docker.internal:3000/api/admin/drive-group/sync"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'drive-group-nightly-sync',
  '0 7 * * *',  -- 07:00 UTC ≈ 2-3am team-local (America/Indiana)
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'drive_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'drive_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
