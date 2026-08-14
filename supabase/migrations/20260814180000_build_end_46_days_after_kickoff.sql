-- Build season ends 46 days after FRC kickoff (not the 3rd Tuesday of February
-- the prior seed assumed), and competition season starts the day after. The
-- Jan 1 build start, the off seasons, and the May 31 competition end are all
-- unchanged, so the calendar stays contiguous with no gaps or overlaps.
--
-- Kickoff dates (source: FIRST / firstinspires.org):
--   2022 Rapid React  Jan 8, 2022      2025 Reefscape  Jan 4, 2025
--   2023 Charged Up   Jan 7, 2023      2026 REBUILT    Jan 10, 2026
--   2024 Crescendo    Jan 6, 2024      2027 BIOCORE    Jan 9, 2027

-- Build season: ends kickoff + 46.
with kickoff (season, kdate) as (
  values
    (2022, date '2022-01-08'),
    (2023, date '2023-01-07'),
    (2024, date '2024-01-06'),
    (2025, date '2025-01-04'),
    (2026, date '2026-01-10'),
    (2027, date '2027-01-09')
)
update period p
set ends_on = k.kdate + 46
from kickoff k
where p.name = k.season || ' Build Season';

-- Competition season: starts kickoff + 47 (the day after build ends).
with kickoff (season, kdate) as (
  values
    (2022, date '2022-01-08'),
    (2023, date '2023-01-07'),
    (2024, date '2024-01-06'),
    (2025, date '2025-01-04'),
    (2026, date '2026-01-10'),
    (2027, date '2027-01-09')
)
update period p
set starts_on = k.kdate + 47
from kickoff k
where p.name = k.season || ' Competition Season';
