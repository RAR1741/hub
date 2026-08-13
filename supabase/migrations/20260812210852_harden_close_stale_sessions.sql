-- Harden close_stale_sessions():
--   1. Re-assert the definition with a pinned `search_path = ''` and
--      schema-qualified table references. The M3 hardening edited the original
--      session_sweep migration in place, but `supabase db push` tracks
--      migrations by version (not content), so any database that had already
--      recorded that version never picked up the change. This new migration
--      applies everywhere. (create-or-replace preserves the existing ACL, so
--      the revoke below still does the work.)
--   2. Revoke public EXECUTE. The function is SECURITY DEFINER and was exposed
--      via PostgREST at /rest/v1/rpc/close_stale_sessions to anon/authenticated,
--      letting anyone trigger the sweep. Only the pg_cron job (postgres) and the
--      service-role "run sweep" route should run it.
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
  return closed_count;
end;
$$;

revoke execute on function public.close_stale_sessions() from public, anon, authenticated;
