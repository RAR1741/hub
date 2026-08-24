insert into person (id, first_name, last_name, role, student_id_number, grad_year)
values ('00000000-0000-0000-0000-000000001741', 'Test', 'Student', 'student', '1741', 2028);

-- Teams are seeded from their own file now: supabase/seeds/teams.sql
-- (loaded after this file — see config.toml [db.seed].sql_paths).

-- Season calendar. These mirror migrations 20260814170000 + 20260814180000 (the
-- source of truth for prod). Upserted here too so a standalone local reseed has
-- the full calendar even without a migration replay. KEEP IN SYNC with those
-- migrations if the calendar changes. Build ends = FRC kickoff + 46 days.
insert into period (name, starts_on, ends_on) values
  ('2021 Off Season',         '2021-06-01', '2021-12-31'),
  ('2022 Build Season',       '2022-01-01', '2022-02-23'),
  ('2022 Competition Season', '2022-02-24', '2022-05-31'),
  ('2022 Off Season',         '2022-06-01', '2022-12-31'),
  ('2023 Build Season',       '2023-01-01', '2023-02-22'),
  ('2023 Competition Season', '2023-02-23', '2023-05-31'),
  ('2023 Off Season',         '2023-06-01', '2023-12-31'),
  ('2024 Build Season',       '2024-01-01', '2024-02-21'),
  ('2024 Competition Season', '2024-02-22', '2024-05-31'),
  ('2024 Off Season',         '2024-06-01', '2024-12-31'),
  ('2025 Build Season',       '2025-01-01', '2025-02-19'),
  ('2025 Competition Season', '2025-02-20', '2025-05-31'),
  ('2025 Off Season',         '2025-06-01', '2025-12-31'),
  ('2026 Build Season',       '2026-01-01', '2026-02-25'),
  ('2026 Competition Season', '2026-02-26', '2026-05-31'),
  ('2026 Off Season',         '2026-06-01', '2026-12-31'),
  ('2027 Build Season',       '2027-01-01', '2027-02-24'),
  ('2027 Competition Season', '2027-02-25', '2027-05-31')
on conflict (name) do update
  set starts_on = excluded.starts_on, ends_on = excluded.ends_on;

-- Deterministic active period for E2E: "2026 Off Season" contains the specs'
-- fixture dates (Sept 2026). Clear first so we never trip one-active-period.
update period set is_active = false;
update period set is_active = true where name = '2026 Off Season';

-- A mentor with a fixed id and a student_id_number so E2E can mint a real
-- mentor session via the student-token branch of resolveViewer (no OAuth needed).
insert into person (id, first_name, last_name, role, student_id_number, email)
values ('00000000-0000-0000-0000-000000000009', 'Test', 'Mentor', 'mentor', '9999', 'mentor@example.com');

-- An admin with a fixed id, same purpose as above, for E2E specs that exercise
-- admin-gated routes (meetings, periods, people, kiosk devices, settings).
insert into person (id, first_name, last_name, role, student_id_number, email)
values ('00000000-0000-0000-0000-00000000000a', 'Test', 'Admin', 'admin', '9998', 'admin@example.com');
