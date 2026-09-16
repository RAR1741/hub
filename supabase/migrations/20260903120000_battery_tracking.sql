-- Battery tracking (v1): replaces the paper per-match battery log sheet and
-- the mentor's inventory spreadsheet with an inventory table (`battery`) and
-- a usage log (`battery_usage`). No event/competition table — event and
-- match are free-text keys in The Blue Alliance shape (`2026incol`, `qm1`),
-- kept loosely TBA-shaped for a later lookup/FK without a data rewrite.

create table battery (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,                       -- e.g. '2026-01'; user-entered, not derived
  -- Extension point for other battery types; nothing reads it in v1.
  kind text not null default 'frc_robot' check (kind in ('frc_robot')),
  year_acquired integer,
  model text,                                        -- e.g. NP18-12B
  serial_date_code text,                              -- e.g. YQ24F
  manufacturer text,                                  -- e.g. Enersys
  trade_name text,                                    -- e.g. Genesis
  amp_hour_rating numeric,                            -- e.g. 17.2
  notes text,
  -- Retire is a PATCH, not a route: retired_at/retired_reason are ordinary
  -- columns, client-settable, so a hand-entered historical battery can
  -- record its actual scrap date. No battery DELETE (see below) — this is
  -- the only lifecycle transition.
  status text not null default 'active' check (status in ('active', 'retired')),
  retired_at timestamptz,
  retired_reason text,
  created_at timestamptz not null default now(),
  check ((status = 'retired') = (retired_at is not null))
);

alter table battery enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on battery to service_role;

create table battery_usage (
  id uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: a battery with usage history can't be deleted out
  -- from under its log. There is no battery DELETE route by design (retire
  -- instead), so this is a backstop, not the primary guard.
  battery_id uuid not null references battery (id) on delete restrict,
  -- Submitter. restrict so merge_person (below) must reassign it, not orphan it.
  tech_id uuid not null references person (id) on delete restrict,
  used_at timestamptz not null default now(),
  event_key text,                                    -- TBA event key, nullable (shop/pit tests)
  match_key text,                                     -- 'qm1' or free text ('Prac 4', 'P7')
  had_problem boolean not null default false,
  problem_description text,
  wiggle_test_ok boolean,                             -- null = not recorded
  charger_test_ok boolean,
  rint_ohms numeric,                                  -- e.g. 0.018
  charge_pre_pct integer check (charge_pre_pct >= 0),
  charge_post_pct integer check (charge_post_pct >= 0),  -- may exceed 100 (overcharge)
  notes text,
  created_at timestamptz not null default now(),
  check (had_problem or problem_description is null)
);

-- Per-battery usage history, newest first: the detail-page log and the LRU
-- "last used" embed (listBatteries) both filter/order this way.
create index battery_usage_battery_used_idx on battery_usage (battery_id, used_at desc);

alter table battery_usage enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on battery_usage to service_role;

-- Re-declare merge_person (20260816120000_merge_people.sql) to add the new
-- battery_usage.tech_id person FK: merge_person is a hardcoded list of
-- `update ... set col = p_winner` statements, so a person FK it doesn't know
-- about makes merging that person fail with 23503 instead of reassigning it.
-- (Pre-existing gap: event, badge, badge_award, form, event_signup were
-- never added either — tracked as a separate task, not fixed here.)
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

  -- battery_usage: submitter (RESTRICT). See migration header for why this
  -- had to be added here rather than left for a future gap-fill.
  update battery_usage set tech_id = p_winner where tech_id = p_loser;

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
