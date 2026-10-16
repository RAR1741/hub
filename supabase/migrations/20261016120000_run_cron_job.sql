-- Run a pg_cron job on demand ("Run now" on /admin/cron).
--
-- Same wrapper pattern as reschedule_cron_job (20260828120000_cron_schedule_admin.sql):
-- the `cron` schema isn't reachable via PostgREST, so a SECURITY DEFINER function
-- reads the job's command and executes it, with search_path = '' like the other
-- cron RPCs. Every job command must therefore be fully schema-qualified. Execution
-- is restricted to service_role.
--
-- Note: HTTP jobs' net.http_post is queued and fires after commit (async), so
-- this returns once the request is queued, not when the endpoint finishes.

-- close-stale-sessions was scheduled with an unqualified call; qualify it so it
-- runs under run_cron_job's empty search_path.
select cron.alter_job(jobid, command := 'select public.close_stale_sessions();')
from cron.job where jobname = 'close-stale-sessions';

create or replace function public.run_cron_job(job_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
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
