-- team <-> GitHub Team link. Null = not linked (same semantics as google_group_email).
alter table team add column if not exists github_team_slug text;

-- Verified GitHub identity, set only by the OAuth callback. id is the stable key
-- (logins can be renamed); login is kept for display and for matching pending invites.
alter table person add column if not exists github_login text;
alter table person add column if not exists github_user_id bigint unique;
-- team and person are already granted to service_role; new columns need no grant.

insert into app_setting (key, value)
values ('github_sync_url', '"http://host.docker.internal:3000/api/admin/github-team/sync"')
on conflict (key) do nothing;
-- github_sync_secret is deliberately NOT seeded: prod must set it or the cron 403s.

select cron.schedule(
  'github-team-nightly-sync',
  '20 7 * * *',   -- 20 min after drive-group-nightly-sync (0 7 * * *); avoids one process doing both at once
  $cron$ select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'github_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'github_sync_secret')),
    body := '{}'::jsonb) $cron$
);
