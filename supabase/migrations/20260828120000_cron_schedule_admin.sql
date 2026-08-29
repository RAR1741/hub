-- Cron schedule admin: expose pg_cron read/reschedule to the app.
--
-- The `cron` schema isn't reachable via PostgREST, so these public
-- SECURITY DEFINER wrapper functions are how the service-role app client
-- (the admin cron-schedule UI) lists jobs and edits their schedule. This
-- migration runs as `postgres`, which owns the existing cron jobs, so the
-- SECURITY DEFINER functions inherit cron-schema access for free.
--
-- Both functions pin search_path = '' and fully schema-qualify every
-- reference, and revoke the default PUBLIC execute grant, restricting
-- execution to service_role only (same hardening pattern as
-- 20260812210852_harden_close_stale_sessions.sql).

create or replace function public.list_cron_jobs()
returns table (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  last_run_started_at timestamptz,
  last_run_status text
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
    lr.status as last_run_status
  from cron.job j
  left join lateral (
    select d.start_time, d.status
    from cron.job_run_details d
    where d.jobid = j.jobid
    order by d.start_time desc
    limit 1
  ) lr on true
  order by j.jobname;
$$;

revoke execute on function public.list_cron_jobs() from public, anon, authenticated;
grant execute on function public.list_cron_jobs() to service_role;

create or replace function public.reschedule_cron_job(job_id bigint, new_schedule text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from cron.job where jobid = job_id) then
    raise exception 'cron job % not found', job_id;
  end if;

  -- pg_cron's alter_job is the validator (accepts both 5-field cron syntax
  -- and interval syntax like '30 seconds'); it raises on an invalid schedule.
  perform cron.alter_job(job_id := job_id, schedule := new_schedule);
end;
$$;

revoke execute on function public.reschedule_cron_job(bigint, text) from public, anon, authenticated;
grant execute on function public.reschedule_cron_job(bigint, text) to service_role;
