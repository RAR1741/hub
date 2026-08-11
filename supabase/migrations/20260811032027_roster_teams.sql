-- Teams: self-referential tree (spec §4). join_mode governs self-service joining (spec §8 answer 1).
create table team (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_team_id uuid references team (id),
  description text,
  join_mode text not null default 'admin_only'
    check (join_mode in ('admin_only', 'open', 'requires_approval')),
  created_at timestamptz not null default now()
);

create table team_membership (
  person_id uuid not null references person (id) on delete cascade,
  team_id uuid not null references team (id) on delete cascade,
  is_manager boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (person_id, team_id)
);

create table membership_application (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  team_id uuid not null references team (id) on delete cascade,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references person (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live application per person per team; history rows (approved/denied) may accumulate.
create unique index one_pending_application_per_person_team
  on membership_application (person_id, team_id)
  where status = 'pending';

-- M1 carry-forward: person.email is the OAuth allowlist key, matched lowercased.
-- Backfill first, then constrain so no mixed-case address can ever silently break the match.
update person set email = lower(email) where email is not null and email <> lower(email);
alter table person add constraint person_email_lowercase check (email = lower(email));

update account_request set email = lower(email) where email is not null and email <> lower(email);
alter table account_request add constraint account_request_email_lowercase check (email = lower(email));

alter table team enable row level security;
alter table team_membership enable row level security;
alter table membership_application enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).
