-- Periods / seasons scope sessions and separate history (spec §4). One active at a time.
create table period (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table session (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  period_id uuid not null references period (id) on delete restrict,
  time_in timestamptz not null default now(),
  time_out timestamptz,
  source text not null default 'kiosk' check (source in ('kiosk', 'manual', 'admin')),
  note text,
  excluded_from_totals boolean not null default false,
  -- edited_by set = a human corrected this; edited_at set with edited_by NULL = the
  -- nightly sweep auto-closed it (system edit). The flagged screen keys off that.
  edited_by uuid references person (id),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open session per person (Den's invariant): a second clock-in while still
-- clocked in violates this and is rejected (23505) by the clock-in code.
create unique index one_open_session_per_person
  on session (person_id)
  where time_out is null;

-- Fast lookups for who's-here and per-person history.
create index session_open_idx on session (time_out) where time_out is null;
create index session_person_idx on session (person_id, time_in);

alter table period enable row level security;
alter table session enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).

insert into app_setting (key, value) values
  ('auto_close_hours', '4'),   -- sweep closes a forgotten session at time_in + this
  ('max_shift_hours', '18');   -- sessions longer than this are "suspect" on the flagged screen
