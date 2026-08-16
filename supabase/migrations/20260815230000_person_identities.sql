-- Multi-email identities (issue #32). One person can hold many sign-in
-- emails / Google logins. person.email stays as the PRIMARY email control
-- knob: writes to it are mirrored into person_identity by trigger, so all
-- existing write paths (admin form, roster import, application import,
-- associate-email, OAuth bootstrap) keep working unchanged.
-- person.auth_user_id is retired in a LATER migration (expand → contract).

create table person_identity (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  email text not null unique check (email = lower(email)),
  -- The linked Google login, once that account has signed in. Nullable:
  -- an admin can pre-register an email before its owner ever logs in.
  auth_user_id uuid unique references auth.users (id) on delete set null,
  is_primary boolean not null default false,
  provider text not null default 'google',
  created_at timestamptz not null default now()
);

-- Exactly-one-primary: at most one primary row per person (the trigger
-- guarantees "at least one" whenever identities exist).
create unique index person_identity_one_primary
  on person_identity (person_id) where is_primary;

create index person_identity_person_id on person_identity (person_id);

-- RLS zero-policy like every table: default-deny; service role bypasses.
alter table person_identity enable row level security;

-- PostgREST (service role) needs explicit table grants on fresh DBs.
grant all on person_identity to service_role;

-- Backfill: one primary identity per person that has an email today.
-- A person linked to auth without a stored email (possible via an early
-- bootstrap) falls back to the auth.users email so their login survives.
insert into person_identity (person_id, email, auth_user_id, is_primary)
select p.id, coalesce(p.email, lower(u.email)), p.auth_user_id, true
from person p
left join auth.users u on u.id = p.auth_user_id
where p.email is not null
   or (p.auth_user_id is not null and u.email is not null);

-- Mirror trigger: person.email is the primary-email control knob.
--  * set to an email the person already holds  -> promote it to primary
--  * set to a brand-new email, primary exists  -> RENAME the primary
--    (keeps its auth link — an admin correcting a typo must not unlink)
--  * set to a brand-new email, no identities   -> insert first primary
--  * blanked, no secondaries                   -> delete the primary
--  * blanked, secondaries exist                -> refuse loudly
-- Unique violations (email owned by another person) propagate as 23505,
-- which existing handlers already map to 409.
create or replace function sync_primary_identity() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;

  if new.email is null then
    if exists (select 1 from person_identity
               where person_id = new.id and not is_primary) then
      raise exception
        'person has other linked emails; remove them or make one primary first'
        using errcode = 'P0001';
    end if;
    delete from person_identity where person_id = new.id and is_primary;
    return new;
  end if;

  if exists (select 1 from person_identity
             where person_id = new.id and email = new.email) then
    update person_identity set is_primary = false
      where person_id = new.id and is_primary and email <> new.email;
    update person_identity set is_primary = true
      where person_id = new.id and email = new.email;
    return new;
  end if;

  if exists (select 1 from person_identity
             where person_id = new.id and is_primary) then
    update person_identity set email = new.email
      where person_id = new.id and is_primary;
    return new;
  end if;

  insert into person_identity (person_id, email, is_primary)
  values (new.id, new.email, true);
  return new;
end $$;

create trigger person_sync_primary_identity
  after insert or update of email on person
  for each row execute function sync_primary_identity();
