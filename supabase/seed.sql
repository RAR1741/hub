insert into person (first_name, last_name, role, student_id_number, grad_year)
values ('Test', 'Student', 'student', '1741', 2028);

-- Teams are seeded from their own file now: supabase/seeds/teams.sql
-- (loaded after this file — see config.toml [db.seed].sql_paths).

insert into period (name, starts_on, ends_on, is_active)
values ('2026–2027 Season', '2026-08-01', '2027-07-31', true);

-- A mentor with a fixed id and a student_id_number so E2E can mint a real
-- mentor session via the student-token branch of resolveViewer (no OAuth needed).
insert into person (id, first_name, last_name, role, student_id_number, email)
values ('00000000-0000-0000-0000-000000000009', 'Test', 'Mentor', 'mentor', '9999', 'mentor@example.com');

-- An admin with a fixed id, same purpose as above, for E2E specs that exercise
-- admin-gated routes (meetings, periods, people, kiosk devices, settings).
insert into person (id, first_name, last_name, role, student_id_number, email)
values ('00000000-0000-0000-0000-00000000000a', 'Test', 'Admin', 'admin', '9998', 'admin@example.com');
