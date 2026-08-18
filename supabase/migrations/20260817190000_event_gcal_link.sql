-- Optional link from a one-off `event` row to the Google Calendar event it
-- mirrors. `gcal_event_id` matches `meeting.gcal_event_id` (already populated
-- by the existing calendar sync) rather than duplicating a live Google API
-- call. Once linked, syncCalendar() keeps name/starts_at/ends_at in lock-step
-- with the calendar; gcal_missing flags a link whose calendar event
-- disappeared upstream, for admin review — it never auto-unlinks or deletes.
alter table event add column gcal_event_id text;
alter table event add column gcal_missing boolean not null default false;

-- One event per calendar event. Postgres treats NULLs as distinct, so any
-- number of unlinked (gcal_event_id null) events coexist untouched.
create unique index event_gcal_event_id_idx on event (gcal_event_id) where gcal_event_id is not null;
