-- Per-job last-success heartbeat for cron jobs (#301).
--
-- cron.job_run_details only says the SQL pg_cron ran succeeded. Every job body is a
-- single async net.http_post(), so a job whose endpoint 403s on every run (unset
-- *_secret) or posts into the void (a *_url still pointing at the dev default) still
-- reports `succeeded`. The work itself has to say it happened: each handler upserts
-- app_setting.cron_heartbeat_<jobname> when it completes, and src/lib/cron-heartbeat.ts
-- flags any active job whose last success is older than its own schedule implies.
--
-- No new table: this is one timestamp per job, the same shape as the
-- system_health_state_* rows already in app_setting.

-- 1. Surface the heartbeat alongside the pg_cron view the admin page already reads.
--    Dropped rather than replaced because the return type gains a column.
drop function if exists public.list_cron_jobs();

create function public.list_cron_jobs()
returns table (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  last_run_started_at timestamptz,
  last_run_status text,
  last_success_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    lr.start_time as last_run_started_at,
    lr.status as last_run_status,
    (hb.value #>> '{}')::timestamptz as last_success_at
  from cron.job j
  left join lateral (
    select d.start_time, d.status
    from cron.job_run_details d
    where d.jobid = j.jobid
    order by d.start_time desc
    limit 1
  ) lr on true
  left join public.app_setting hb on hb.key = 'cron_heartbeat_' || j.jobname
  order by j.jobname;
$$;

revoke execute on function public.list_cron_jobs() from public, anon, authenticated;
grant execute on function public.list_cron_jobs() to service_role;

-- 2. close-stale-sessions is the one job with no HTTP handler, so it records its own
--    heartbeat. The admin "run sweep" route calls the same function and will also
--    refresh it — acceptable: unlike the HTTP jobs there is no secret to be unset, so a
--    manual run can't mask the failure mode this detects.
create or replace function public.close_stale_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text;
  close_hours numeric;
  today_start timestamptz;
  closed_count integer;
begin
  select coalesce(value #>> '{}', 'America/Indiana/Indianapolis') into tz
    from public.app_setting where key = 'team_timezone';
  if tz is null then tz := 'America/Indiana/Indianapolis'; end if;

  select coalesce((value #>> '{}')::numeric, 4) into close_hours
    from public.app_setting where key = 'auto_close_hours';
  if close_hours is null then close_hours := 4; end if;

  today_start := date_trunc('day', now() at time zone tz) at time zone tz;

  update public.session
     set time_out = time_in + (close_hours * interval '1 hour'),
         edited_at = now()          -- edited_by stays NULL: this is a system close
   where time_out is null
     and time_in < today_start;

  get diagnostics closed_count = row_count;

  insert into public.app_setting (key, value)
  values ('cron_heartbeat_close-stale-sessions', to_jsonb(now()))
  on conflict (key) do update set value = excluded.value;

  return closed_count;
end;
$$;

revoke execute on function public.close_stale_sessions() from public, anon, authenticated;

-- 3. Seed every active job so the deploy itself doesn't read as 11 dead jobs. Each job
--    gets exactly one period of grace to record a real heartbeat.
insert into public.app_setting (key, value)
select 'cron_heartbeat_' || jobname, to_jsonb(now())
from cron.job
where active
on conflict (key) do nothing;
