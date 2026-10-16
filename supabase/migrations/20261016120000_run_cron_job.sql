-- Run a pg_cron job on demand ("Run now" on /admin/cron).
--
-- Same wrapper pattern as reschedule_cron_job (20260828120000_cron_schedule_admin.sql):
-- the `cron` schema isn't reachable via PostgREST, so a SECURITY DEFINER function
-- reads the job's command and executes it. Unlike the other wrappers, search_path
-- is pinned to public (not ''): job commands are unqualified SQL such as
-- `select close_stale_sessions();`, as pg_cron itself would run them. Execution is
-- restricted to service_role.
--
-- Note: HTTP jobs' net.http_post is queued and fires after commit (async), so
-- this returns once the request is queued, not when the endpoint finishes.
-- Equivalent to the manual `do $$ begin execute (select command from cron.job
-- where ...) end $$` workaround.

create or replace function public.run_cron_job(job_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_command text;
begin
  select command into v_command from cron.job where jobid = job_id;
  if v_command is null then
    raise exception 'cron job % not found', job_id;
  end if;

  execute v_command;
end;
$$;

revoke execute on function public.run_cron_job(bigint) from public, anon, authenticated;
grant execute on function public.run_cron_job(bigint) to service_role;
