-- Events: mentor-created gatherings tied to a period, with self-service
-- sign-up and a mentor-run check-in roster. Check-ins land in `session`
-- (source='event') so they reuse existing hours/leaderboard/reports math
-- with zero changes elsewhere. See issue #23 (narrowed v1 scope).

create table event (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references period (id) on delete restrict,
  name text not null,
  location text,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid not null references person (id),
  created_at timestamptz not null default now(),
  constraint event_ends_after_starts check (ends_at > starts_at)
);

create index event_period_idx on event (period_id, starts_at);
create index event_starts_at_idx on event (starts_at);
-- Serves listUpcomingEvents()'s `ends_at >= now()` filter, ordered by starts_at.
create index event_ends_at_idx on event (ends_at, starts_at);

alter table event enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

create table event_signup (
  event_id uuid not null references event (id) on delete cascade,
  person_id uuid not null references person (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, person_id)
);

-- Composite PK covers the roster query (event_id = ...); this composite
-- index (leading person_id) covers signedUpEventIds()'s lookup
-- (person_id = ... AND event_id IN (...)) in the direction the PK doesn't.
create index event_signup_person_event_idx on event_signup (person_id, event_id);

alter table event_signup enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

-- Event check-ins are ordinary sessions with a new source + a link back to
-- the event. `event_id` is restrict-on-delete (like `session.period_id`) so
-- deleting an event can't silently orphan attendance history; deleteEvent()
-- checks for existing check-ins first and returns a clean 409 instead.
-- NOT VALID + separate VALIDATE skips the full-table scan while dropping
-- the lock; existing rows already satisfy both constraints (the new source
-- check is a superset of the old, and event_id is a brand-new nullable
-- column so no row can yet violate the event_id/source pairing).
alter table session drop constraint if exists session_source_check;
alter table session add constraint session_source_check
  check (source in ('kiosk', 'manual', 'admin', 'import', 'event')) not valid;
alter table session validate constraint session_source_check;

alter table session add column event_id uuid references event (id) on delete restrict;

-- event_id must be set if and only if source='event', so every event
-- check-in is scopable and the per-person-per-event uniqueness guarantee
-- below can't be bypassed by a source='event' row with a null event_id.
alter table session add constraint session_event_id_requires_event_source
  check ((source = 'event') = (event_id is not null)) not valid;
alter table session validate constraint session_event_id_requires_event_source;

create unique index one_session_per_person_per_event
  on session (person_id, event_id)
  where event_id is not null;

create index session_event_idx on session (event_id) where event_id is not null;
