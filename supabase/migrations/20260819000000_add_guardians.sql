-- Create guardian table for storing parent/guardian contact information
-- Guardians are shared across students (siblings case): a guardian record is edited once, reflects on all linked students
create table if not exists public.guardian (
  id bigint primary key generated always as identity,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  employer text,
  last_application_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

-- Create person_guardian many-to-many join table linking students to guardians with relationship
-- PK is (person_id, guardian_id) to prevent duplicate links
create table if not exists public.person_guardian (
  person_id bigint not null references public.person(id) on delete cascade,
  guardian_id bigint not null references public.guardian(id) on delete cascade,
  relationship text,
  updated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  primary key (person_id, guardian_id)
);

-- Enable RLS on both tables (service role only, like rest of roster)
alter table public.guardian enable row level security;
alter table public.person_guardian enable row level security;

-- RLS policies: service role bypasses, default deny all other users
create policy "service_role_all" on public.guardian
  as permissive for all
  using (auth.role() = 'service_role');

create policy "service_role_all" on public.person_guardian
  as permissive for all
  using (auth.role() = 'service_role');
