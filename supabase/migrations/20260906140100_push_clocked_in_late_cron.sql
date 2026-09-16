-- 20260906140100_push_clocked_in_late_cron.sql
-- Nightly "still clocked in" nudge. Fixed UTC hour (pg_cron runs in UTC and
-- can't read the team timezone). 03:00 UTC ≈ 10pm EST / 11pm EDT — an evening
-- hour, and BEFORE the 08:00 UTC close-stale-sessions sweep so there are still
-- open sessions to nudge. Adjust via the /admin/cron editor if the team moves.
-- URL + shared secret read from app_setting at run time (set per-env in prod).
insert into app_setting (key, value) values
  ('push_clocked_in_late_url', '"http://host.docker.internal:3000/api/cron/push/clocked-in-late"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'push-clocked-in-late',
  '0 3 * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'push_clocked_in_late_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'push_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
