create type person_role as enum ('admin', 'mentor', 'captain', 'student');

create table person (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  display_name text,
  role person_role not null default 'student',
  grad_year integer,
  email text unique,
  phone text,
  shirt_size text,
  dietary_restrictions text,
  bio text,
  avatar_path text,
  is_active boolean not null default true,
  student_id_number text unique,
  auth_user_id uuid unique references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table account_request (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  grad_year integer,
  email text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references person (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table kiosk_device (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  created_by uuid references person (id),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table app_setting (
  key text primary key,
  value jsonb not null
);

alter table person enable row level security;
alter table account_request enable row level security;
alter table kiosk_device enable row level security;
alter table app_setting enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).

insert into app_setting (key, value)
values ('team_timezone', '"America/Indiana/Indianapolis"');
