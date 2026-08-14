-- Canonical season calendar, seeded as a migration so it reaches every
-- environment (prod via `db push`; local `db reset` replays it). Local and prod
-- had different ad-hoc periods; this replaces them with one consistent set.
--
-- WARNING: this DELETES every session. That is intentional and coordinated —
-- the team is re-importing all attendance into the periods below. Excusals are
-- keyed by date (no period FK) and a re-import replaces the source='import'
-- ones, so they are left as-is. `session` is the only table referencing
-- `period`, so clearing sessions first lets the old periods be removed.
--
-- Each competition year splits into three contiguous periods (no gaps/overlaps):
--   <Y-1> Off Season       : Jun 1 (Y-1)      -> Dec 31 (Y-1)
--   <Y>   Build Season       : Jan 1 (Y)        -> 3rd Tuesday of February (Y)
--   <Y>   Competition Season : day after build  -> May 31 (Y)
--
-- Coverage: 2021 Off Season (Jun 2021) through 2027 Competition Season (May 2027).
-- The build-end dates are the 3rd Tuesday of February, precomputed per year.

delete from session;
delete from period;

insert into period (name, starts_on, ends_on) values
  ('2021 Off Season',         '2021-06-01', '2021-12-31'),
  ('2022 Build Season',       '2022-01-01', '2022-02-15'), -- 3rd Tue Feb 2022
  ('2022 Competition Season', '2022-02-16', '2022-05-31'),
  ('2022 Off Season',         '2022-06-01', '2022-12-31'),
  ('2023 Build Season',       '2023-01-01', '2023-02-21'), -- 3rd Tue Feb 2023
  ('2023 Competition Season', '2023-02-22', '2023-05-31'),
  ('2023 Off Season',         '2023-06-01', '2023-12-31'),
  ('2024 Build Season',       '2024-01-01', '2024-02-20'), -- 3rd Tue Feb 2024
  ('2024 Competition Season', '2024-02-21', '2024-05-31'),
  ('2024 Off Season',         '2024-06-01', '2024-12-31'),
  ('2025 Build Season',       '2025-01-01', '2025-02-18'), -- 3rd Tue Feb 2025
  ('2025 Competition Season', '2025-02-19', '2025-05-31'),
  ('2025 Off Season',         '2025-06-01', '2025-12-31'),
  ('2026 Build Season',       '2026-01-01', '2026-02-17'), -- 3rd Tue Feb 2026
  ('2026 Competition Season', '2026-02-18', '2026-05-31'),
  ('2026 Off Season',         '2026-06-01', '2026-12-31'),
  ('2027 Build Season',       '2027-01-01', '2027-02-16'), -- 3rd Tue Feb 2027
  ('2027 Competition Season', '2027-02-17', '2027-05-31');

-- Activate the period that contains the day this runs (exactly one, since the
-- periods don't overlap; none if run outside 2021-06-01 .. 2027-05-31).
update period set is_active = true
where current_date between starts_on and ends_on;
