-- FIRST roster sync (v1: mentors). Status columns live on person; current
-- standing only, no history. Raw values as FIRST reports them.
alter table person
  add column first_people_id integer unique,
  add column first_consent_release boolean,
  add column first_screening_status text,
  add column first_screening_text text,
  add column first_training_status text,
  add column first_synced_at timestamptz;

insert into app_setting (key, value) values
  ('first_team_profile_id', '1790765'),
  -- Set per-env; empty never authorizes the cron header (see sync route).
  ('first_sync_secret', '""'),
  -- Locally the app runs on the host-mapped port; set to the prod URL on the hosted project.
  ('first_sync_url', '"http://host.docker.internal:3000/api/admin/first/sync"'),
  ('first_session', 'null'),
  ('first_last_sync_report', 'null')
on conflict (key) do nothing;
