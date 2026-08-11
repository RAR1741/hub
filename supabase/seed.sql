insert into person (first_name, last_name, role, student_id_number, grad_year)
values ('Test', 'Student', 'student', '1741', 2028);

insert into team (name, description, join_mode)
values ('Red Alert Robotics', 'The whole team', 'admin_only');

insert into team (name, parent_team_id, description, join_mode)
values
  ('Programming', (select id from team where name = 'Red Alert Robotics'), 'Software subteam', 'open'),
  ('Mechanical',  (select id from team where name = 'Red Alert Robotics'), 'Mechanical subteam', 'requires_approval');

insert into period (name, starts_on, ends_on, is_active)
values ('2026–2027 Season', '2026-08-01', '2027-07-31', true);
