-- Merge-duplicate-people support (issue #33): a name-alias table so a
-- merged-away name resolves to the canonical person on re-import, plus an
-- atomic merge function that reassigns every reference from loser to winner
-- and deletes the loser in one transaction.

create table person_name_alias (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  -- Canonical lookup key; MUST match src/lib/name-match.ts nameKey().
  name_key text generated always as (lower(btrim(first_name)) || '|' || lower(btrim(last_name))) stored,
  created_at timestamptz not null default now(),
  unique (name_key)
);

create index person_name_alias_person_id on person_name_alias (person_id);

alter table person_name_alias enable row level security;
-- House pattern: default-deny, no policies; all access via service role.
grant all on person_name_alias to service_role;

-- Atomically merge p_loser into p_winner. Reassigns subject rows (deleting a
-- loser row first when it would collide with an existing winner row on a
-- unique/PK), reassigns RESTRICT actor columns, moves the loser's sign-in
-- identities to the winner as secondaries, records the loser's name (and
-- re-parents the loser's aliases) as winner aliases, then deletes the loser.
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
