-- Application-sourced person enrichment. All nullable: pre-existing rows and
-- people who never applied simply lack them.
alter table person
  add column date_of_birth date,
  add column street_address text,
  add column city text,
  add column zip text,
  add column home_phone text,
  add column school text,
  add column ethnicity text,
  add column race text,
  add column interests text[],
  -- Timestamp of the newest application response applied to this row.
  -- The importer only overwrites when the incoming response is newer, which
  -- makes imports idempotent and order-independent ("latest wins").
  add column last_application_at timestamptz;

-- A parent/guardian. Shared across siblings: the importer matches existing
-- guardians by normalized name + (email or phone) before creating one.
create table guardian (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  employer text,
  -- Same latest-wins mechanic as person.last_application_at: stores the newest
  -- application RESPONSE timestamp applied to this row. (Wall-clock updated_at
  -- would make every historical response look stale after the first import.)
  last_application_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Many-to-many: relationship is per (student, guardian) pair.
create table person_guardian (
  person_id uuid not null references person (id) on delete cascade,
  guardian_id uuid not null references guardian (id) on delete cascade,
  relationship text,
  primary key (person_id, guardian_id)
);

-- Prior FIRST participation, one row per (person, program level, season year).
-- name is the game/challenge name ("Rapid React", "Relic Recovery").
create table first_experience (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  level text not null check (level in ('fll_explore', 'fll_challenge', 'ftc', 'frc')),
  year int not null,
  name text,
  unique (person_id, level, year)
);

alter table guardian enable row level security;
alter table person_guardian enable row level security;
alter table first_experience enable row level security;
-- House pattern: default-deny, no policies; all access via service role.
