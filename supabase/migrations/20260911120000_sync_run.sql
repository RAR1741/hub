-- Sync run history table: record every integration sync (FIRST, Calendar, Drive, GitHub, Slack)
-- for admin investigation. Retention: 90 days, pruned by close_stale_sessions() cron job.
-- No "running" state (timeout→missing row is the signal); error logged only on failure.
create table sync_run (
  id          uuid primary key default gen_random_uuid(),
  source      text not null
    check (source in ('first_sync','calendar_sync','drive_sync','github_sync','slack_sync')),
  ok          boolean not null,
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  error       text,
  detail      jsonb
);
comment on table sync_run is 'Integration sync history: one row per run. Duration derived as finished_at - started_at. ~10k rows at 90-day retention (first_sync every 15 min).';
comment on column sync_run.id is 'Repo convention: unordered UUID, not a sequence.';
comment on column sync_run.source is 'One of five integration sources (FIRST roster, Google Calendar, Drive groups, GitHub teams, Slack membership).';
comment on column sync_run.ok is 'true: sync succeeded. false: sync threw (error column set).';
comment on column sync_run.started_at is 'Date.now() captured by the caller before the sync started.';
comment on column sync_run.finished_at is 'When the sync completed, defaulting to now().';
comment on column sync_run.error is 'null when ok. Error.stack when available (first line = message), else the message string; truncated to 8000 chars.';
comment on column sync_run.detail is 'Flat {name: number} counts supplied by the caller (e.g., {meetings: 12, buildDays: 3}). null on failure.';

-- Ordering index for the admin page (newest-first with optional filters).
create index sync_run_finished_at_idx on sync_run (finished_at desc);

-- Service-role-only by design: no user policies, default-deny.
alter table sync_run enable row level security;

-- Grant all access to service role (required for fresh DB, else all queries 42501).
grant all on sync_run to service_role;

-- Extend the nightly session-sweep to prune sync_run rows older than 90 days.
-- The 90-day delete MUST run before the auto_close_enabled gate: prod has the toggle
-- set to false (disabled), so a prune after the gate would never run. This way, the
-- housekeeping happens regardless of whether auto-close is enabled.
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
  -- Nightly housekeeping that must run regardless of the auto-close toggle.
  delete from public.sync_run where finished_at < now() - interval '90 days';

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
