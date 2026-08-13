-- Seed the org's team tree as a migration so it reaches every environment
-- (prod included — seed files only run on local `db reset`, never on prod).
--
-- Every team joins 'admin_only' with no description. Inserts are ordered
-- parent-before-child; children look their parent up by name so no uuid is
-- hard-coded. `on conflict (name) do nothing` keeps it safe if a team of the
-- same name already exists.
--
-- Tree:
--   Red Alert Robotics
--     ├─ RARPO
--     ├─ Alumni
--     ├─ FRC
--     │    ├─ FRC Mentor
--     │    └─ FRC Student
--     │         ├─ Captain
--     │         └─ Lead
--     └─ FTC
--          ├─ FTC Mentor
--          └─ FTC Student

-- Root
insert into team (name, join_mode) values ('Red Alert Robotics', 'admin_only')
on conflict (name) do nothing;

-- Level 1 — under Red Alert Robotics
insert into team (name, parent_team_id, join_mode)
values
  ('RARPO',  (select id from team where name = 'Red Alert Robotics'), 'admin_only'),
  ('Alumni', (select id from team where name = 'Red Alert Robotics'), 'admin_only'),
  ('FRC',    (select id from team where name = 'Red Alert Robotics'), 'admin_only'),
  ('FTC',    (select id from team where name = 'Red Alert Robotics'), 'admin_only')
on conflict (name) do nothing;

-- Level 2 — under FRC and FTC
insert into team (name, parent_team_id, join_mode)
values
  ('FRC Mentor',  (select id from team where name = 'FRC'), 'admin_only'),
  ('FRC Student', (select id from team where name = 'FRC'), 'admin_only'),
  ('FTC Mentor',  (select id from team where name = 'FTC'), 'admin_only'),
  ('FTC Student', (select id from team where name = 'FTC'), 'admin_only')
on conflict (name) do nothing;

-- Level 3 — under FRC Student
insert into team (name, parent_team_id, join_mode)
values
  ('Captain', (select id from team where name = 'FRC Student'), 'admin_only'),
  ('Lead',    (select id from team where name = 'FRC Student'), 'admin_only')
on conflict (name) do nothing;
