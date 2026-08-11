-- Timezone-aware forgotten-sign-out heal. Closes sessions still open from a
-- PREVIOUS local day, backdating time_out to time_in + auto_close_hours so a
-- forgotten sign-out doesn't record an all-night shift. Marks edited_at (with
-- edited_by NULL = system) so the flagged screen surfaces it for review.
create or replace function close_stale_sessions()
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

  -- Start of the current day in the team timezone, as a UTC instant.
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

-- Schedule the sweep once daily at 08:00 UTC (~3-4am US Eastern year-round, well
-- after the shop closes). pg_cron runs in UTC; the function itself does the
-- timezone conversion, so the exact UTC hour only needs to land in the early
-- local morning.
create extension if not exists pg_cron;
select cron.schedule('close-stale-sessions', '0 8 * * *', 'select close_stale_sessions();');
