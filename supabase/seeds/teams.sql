-- Teams seed — the org's team tree (roster subteams).
-- Loaded on `supabase db reset` via supabase/config.toml -> [db.seed].sql_paths.
--
-- Columns (defined in migrations/20260811032027_roster_teams.sql):
--   name            text   — REQUIRED, must be UNIQUE
--   parent_team_id  uuid   — optional; the parent team's id (self-referential tree)
--   description     text   — optional
--   join_mode       text   — 'admin_only' (default) | 'open' | 'requires_approval'
--                            governs self-service joining from the member Teams page:
--                              admin_only        = only a mentor/admin can add members
--                              open              = anyone can join instantly
--                              requires_approval = anyone can apply; a reviewer approves
--
-- `on conflict (name) do nothing` keeps this idempotent — editing and re-seeding
-- (or a partial reload) never errors on rows that already exist.

-- Root team. Subteams reference it via parent_team_id.
insert into team (name, description, join_mode)
values ('Red Alert Robotics', 'The whole team', 'admin_only')
on conflict (name) do nothing;

-- Subteams — look the parent up by name so you never hard-code a uuid.
-- Populate with the real structure. Example (uncomment / edit):
--
-- insert into team (name, parent_team_id, description, join_mode)
-- values
--   ('Programming', (select id from team where name = 'Red Alert Robotics'), 'Software subteam',   'open'),
--   ('Mechanical',  (select id from team where name = 'Red Alert Robotics'), 'Mechanical subteam', 'requires_approval'),
--   ('Electrical',  (select id from team where name = 'Red Alert Robotics'), 'Electrical subteam', 'requires_approval')
-- on conflict (name) do nothing;
