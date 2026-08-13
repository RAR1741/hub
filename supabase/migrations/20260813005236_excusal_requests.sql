-- Self-service excusal requests: a student requests an excused absence for a
-- date; a mentor+ reviews (approve creates a normal `excusal`, deny just
-- records the decision). Mirrors the account_request/membership_application
-- review pattern (spec M6 #28).
create table excusal_request (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references person (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- One PENDING request per person+date (re-request allowed after a decision).
create unique index one_pending_excusal_request_per_person_date
  on excusal_request (person_id, date) where status = 'pending';

-- Fast lookup for the mentor review queue.
create index excusal_request_status_idx on excusal_request (status);

alter table excusal_request enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).

insert into app_setting (key, value) values ('season_hours_goal', '0')
  on conflict (key) do nothing;   -- 0 = no goal set
