-- Google Calendar events, upserted by the sync job (spec §4, §5). One row per event.
create table meeting (
  id uuid primary key default gen_random_uuid(),
  gcal_event_id text not null unique,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- A date the team is expected to meet. kind is STORED, not derived at query time
-- (CH's warning). source records whether the calendar sync or an admin set it:
-- a manual row wins and the sync must not overwrite it.
create table build_day (
  date date primary key,
  kind text not null default 'required' check (kind in ('required', 'optional')),
  source text not null default 'manual' check (source in ('gcal', 'manual')),
  meeting_id uuid references meeting (id) on delete set null
);

-- An excused (person, date). Shrinks the attendance denominator (CH's math).
create table excusal (
  person_id uuid not null references person (id) on delete cascade,
  date date not null,
  note text,
  created_by uuid references person (id),
  created_at timestamptz not null default now(),
  primary key (person_id, date)
);

alter table meeting enable row level security;
alter table build_day enable row level security;
alter table excusal enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).

insert into app_setting (key, value) values
  ('gcal_calendar_id', '""'),    -- the Google Calendar id to sync (empty until configured)
  ('gcal_sync_secret', '""');    -- shared secret pg_cron sends as x-sync-secret; empty = sync
                                 -- endpoint rejects the secret path (session path still works)
