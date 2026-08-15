-- Add an `auto_close_enabled` toggle for the nightly session sweep.
--
-- Auto-closing stale open sessions is still a TBD behavior the mentors haven't
-- signed off on, so it ships DISABLED: seed the flag to false and gate
-- close_stale_sessions() on it. When disabled the function no-ops (returns 0),
-- which covers both the pg_cron nightly job and the manual "run sweep" route,
-- since both call this one function. Flip the setting to `true` from
-- /admin/settings to turn it back on; `auto_close_hours` still governs the
-- close duration when it is.
insert into app_setting (key, value) values
  ('auto_close_enabled', 'false')
on conflict (key) do nothing;

create or replace function public.close_stale_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled boolean;
  tz text;
  close_hours numeric;
  today_start timestamptz;
  closed_count integer;
begin
  -- Feature gate: unless auto_close_enabled is explicitly true, do nothing.
  select coalesce((value #>> '{}')::boolean, false) into enabled
    from public.app_setting where key = 'auto_close_enabled';
  if enabled is not true then
    return 0;
  end if;

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
