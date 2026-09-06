-- Tool maintenance & checks tracking (v1): a straight mirror of battery
-- tracking (20260903120000_battery_tracking.sql) — an inventory table
-- (`tool`) and an append-only check log (`tool_check`), plus a student
-- "request deletion" flow (`tool_delete_request`) mirroring excusal_request.
-- See docs/superpowers/specs/2026-09-06-tool-maintenance-tracking-design.md.

create table tool (
  id uuid primary key default gen_random_uuid(),
  name text not null,                                 -- 'Drill press', 'DeWalt 20V drill #2'
  category text,                                      -- free text: 'power tool', 'hand tool', 'machine'
  location text,                                      -- free text: 'Bench 3', 'Red cabinet'
  asset_tag text unique,                              -- optional serial / asset tag; nulls distinct
  status text not null default 'in_service'
    check (status in ('in_service', 'needs_attention', 'out_of_service', 'retired')),
  maintenance_interval_days integer check (maintenance_interval_days > 0),  -- null = no schedule
  notes text,
  created_at timestamptz not null default now()
);
alter table tool enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on tool to service_role;

create table tool_check (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tool (id) on delete cascade,   -- mentor DELETE takes the log with it
  checked_by uuid not null references person (id) on delete restrict,  -- submitter
  checked_at timestamptz not null default now(),
  kind text not null check (kind in ('inspection', 'maintenance', 'repair')),
  condition text not null check (condition in ('good', 'fair', 'poor')),
  -- Null = no status change. Never 'retired': retire is a deliberate PATCH, not a check side effect.
  status_after text check (status_after in ('in_service', 'needs_attention', 'out_of_service')),
  notes text,
  created_at timestamptz not null default now()
);
-- Per-tool history newest first: detail page and the last-checked embed (listTools).
create index tool_check_tool_checked_idx on tool_check (tool_id, checked_at desc);
alter table tool_check enable row level security;
grant all on tool_check to service_role;

-- A check with status_after flips the tool. AFTER INSERT only: deleting a check does not revert.
-- `status <> 'retired'`: logging a check never un-retires a tool.
create function tool_check_apply_status() returns trigger language plpgsql as $$
begin
  update tool set status = new.status_after where id = new.tool_id and status <> 'retired';
  return new;
end $$;
create trigger tool_check_apply_status after insert on tool_check
  for each row when (new.status_after is not null) execute function tool_check_apply_status();

-- Student "please delete this tool" → mentor review. Mirrors excusal_request
-- (20260813005617_excusal_requests.sql). tool_id cascades: approving deletes the tool, which
-- takes the (now approved) request row with it — approved rows never survive, denied ones do.
create table tool_delete_request (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tool (id) on delete cascade,
  requested_by uuid not null references person (id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references person (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
-- One PENDING request per tool (re-request allowed after a denial). Also serves the
-- `status = 'pending'` queue query, so no separate status index.
create unique index one_pending_tool_delete_request_per_tool
  on tool_delete_request (tool_id) where status = 'pending';
alter table tool_delete_request enable row level security;
grant all on tool_delete_request to service_role;

-- Re-declare merge_person (latest declaration: 20260903120000_battery_tracking.sql) to add the
-- three new tool_* person FKs: merge_person is a hardcoded list of `update ... set col =
-- p_winner` statements, so a person FK it doesn't know about makes merging that person fail
-- with 23503 instead of reassigning it.
create or replace function merge_person(p_winner uuid, p_loser uuid)
returns void
language plpgsql
as $$
declare
  v_loser_first text;
  v_loser_last text;
  v_loser_email text;
begin
  if p_winner = p_loser then
    raise exception 'cannot merge a person into themselves' using errcode = 'P0001';
  end if;
  if not exists (select 1 from person where id = p_winner) then
    raise exception 'winner % not found', p_winner using errcode = 'P0002';
  end if;
  select first_name, last_name, email into v_loser_first, v_loser_last, v_loser_email
    from person where id = p_loser;
  if v_loser_first is null then
    raise exception 'loser % not found', p_loser using errcode = 'P0002';
  end if;

  -- session: partial unique `one_open_session_per_person` on (person_id) where
  -- time_out is null. If both have an OPEN session, drop the loser's open one
  -- (a spurious concurrent clock-in) before reassigning so the invariant holds.
  delete from session l
    where l.person_id = p_loser and l.time_out is null
      and exists (select 1 from session w
                  where w.person_id = p_winner and w.time_out is null);
  update session set person_id = p_winner where person_id = p_loser;
  update session set edited_by = p_winner where edited_by = p_loser;

  -- team_membership: PK (person_id, team_id). Carry the loser's manager flag
  -- onto the winner's row for shared teams before dropping the loser's dup.
  update team_membership w
    set is_manager = w.is_manager or l.is_manager
    from team_membership l
    where l.person_id = p_loser and w.person_id = p_winner and w.team_id = l.team_id;
  delete from team_membership l
    where l.person_id = p_loser
      and exists (select 1 from team_membership w
                  where w.person_id = p_winner and w.team_id = l.team_id);
  update team_membership set person_id = p_winner where person_id = p_loser;

  -- membership_application: partial unique (person_id, team_id) where pending.
  delete from membership_application l
    where l.person_id = p_loser and l.status = 'pending'
      and exists (select 1 from membership_application w
                  where w.person_id = p_winner and w.team_id = l.team_id
                    and w.status = 'pending');
  update membership_application set person_id = p_winner where person_id = p_loser;
  update membership_application set reviewed_by = p_winner where reviewed_by = p_loser;

  -- excusal: PK (person_id, date).
  delete from excusal l
    where l.person_id = p_loser
      and exists (select 1 from excusal w
                  where w.person_id = p_winner and w.date = l.date);
  update excusal set person_id = p_winner where person_id = p_loser;
  update excusal set created_by = p_winner where created_by = p_loser;

  -- excusal_request: partial unique (person_id, date) where pending.
  delete from excusal_request l
    where l.person_id = p_loser and l.status = 'pending'
      and exists (select 1 from excusal_request w
                  where w.person_id = p_winner and w.date = l.date
                    and w.status = 'pending');
  update excusal_request set person_id = p_winner where person_id = p_loser;
  update excusal_request set reviewed_by = p_winner where reviewed_by = p_loser;

  -- person_guardian: PK (person_id, guardian_id).
  delete from person_guardian l
    where l.person_id = p_loser
      and exists (select 1 from person_guardian w
                  where w.person_id = p_winner and w.guardian_id = l.guardian_id);
  update person_guardian set person_id = p_winner where person_id = p_loser;

  -- first_experience: unique (person_id, level, year).
  delete from first_experience l
    where l.person_id = p_loser
      and exists (select 1 from first_experience w
                  where w.person_id = p_winner and w.level = l.level and w.year = l.year);
  update first_experience set person_id = p_winner where person_id = p_loser;

  -- person_identity: emails are globally unique (no collision). Move to winner
  -- as secondaries; winner keeps its own primary. (The winner adopting the
  -- loser's email as its primary happens AFTER the loser row is deleted below,
  -- so it can't collide with the loser's still-present person.email.)
  update person_identity
    set person_id = p_winner, is_primary = false
    where person_id = p_loser;

  -- account_request / kiosk_device actor columns (RESTRICT).
  update account_request set reviewed_by = p_winner where reviewed_by = p_loser;
  update kiosk_device set created_by = p_winner where created_by = p_loser;

  -- battery_usage: submitter (RESTRICT). See 20260903120000_battery_tracking.sql header for why
  -- this had to be added here rather than left for a future gap-fill.
  update battery_usage set tech_id = p_winner where tech_id = p_loser;

  -- tool_check / tool_delete_request: submitter and reviewer person FKs. Same reasoning as
  -- battery_usage above.
  update tool_check set checked_by = p_winner where checked_by = p_loser;
  update tool_delete_request set requested_by = p_winner where requested_by = p_loser;
  update tool_delete_request set reviewed_by = p_winner where reviewed_by = p_loser;

  -- Re-parent the loser's existing aliases, then record the loser's own name.
  -- name_key is globally unique; on collision the alias already resolves
  -- somewhere, so skip.
  update person_name_alias set person_id = p_winner where person_id = p_loser;
  insert into person_name_alias (person_id, first_name, last_name)
    values (p_winner, v_loser_first, v_loser_last)
    on conflict (name_key) do nothing;

  delete from person where id = p_loser;

  -- Restore the #32 exactly-one-primary invariant: if the winner had NO email
  -- of its own (e.g. a name-only time-import auto-create picked as canonical),
  -- it now holds moved identities but no primary. Done AFTER deleting the loser
  -- so the winner can adopt the loser's email without colliding with the (now
  -- gone) loser's person.email UNIQUE. Setting person.email fires the mirror
  -- trigger, which promotes the matching moved identity to primary.
  if v_loser_email is not null then
    update person set email = v_loser_email
      where id = p_winner and email is null;
  end if;
end $$;

grant execute on function merge_person(uuid, uuid) to service_role;
