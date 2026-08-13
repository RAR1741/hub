-- Manual meetings (admin-created, not synced from Google Calendar) have no
-- gcal_event_id. The unique constraint is untouched: Postgres treats NULLs as
-- distinct, so any number of manual rows with a null gcal_event_id coexist,
-- and the gcal upsert (onConflict: gcal_event_id) can never match/clobber them.
alter table meeting alter column gcal_event_id drop not null;
