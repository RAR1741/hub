-- 20260910120000_reminder_offsets.sql
-- Per-signup event reminders + per-person global meeting reminder lead times.
-- Replaces the fixed 3h team-wide meeting reminder (reminder_pushed_at).

-- (a) Events: one row per (signup, offset). The row IS the choice and the
-- dedupe marker (pushed_at). Composite FK -> event_signup so cancel cascades.
create table event_signup_reminder (
  event_id  uuid not null,
  person_id uuid not null,
  minutes   int  not null,
  pushed_at timestamptz,
  primary key (event_id, person_id, minutes),
  constraint event_signup_reminder_minutes_check check (minutes in (15, 30, 60, 120)),
  constraint event_signup_reminder_signup_fk
    foreign key (event_id, person_id)
    references event_signup (event_id, person_id) on delete cascade
);
-- Sweep reads "unpushed rows for events in window".
create index event_signup_reminder_pending_idx
  on event_signup_reminder (event_id) where pushed_at is null;

alter table event_signup_reminder enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on event_signup_reminder to service_role;

-- (b) Meetings: one global set per person. Default {60} backfills every
-- existing row, so currently opted-in people keep getting a reminder.
alter table person add column meeting_reminder_minutes int[] not null default '{60}'
  constraint person_meeting_reminder_minutes_check
  check (meeting_reminder_minutes <@ array[15, 30, 60, 120]);

-- (c) Meeting dedupe: which offsets have already fired for this meeting.
-- Due-ness of an offset depends only on (starts_at, now), so one stamp per
-- (meeting, offset) is exactly-once for every (person, meeting, offset).
alter table meeting drop column reminder_pushed_at;
alter table meeting add column reminder_pushed_minutes int[] not null default '{}';
