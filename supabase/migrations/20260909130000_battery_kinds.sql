-- battery.kind: widen the v1 single-value check (#245). v1 wrote nothing but the
-- default; parseBatteryInput now accepts kind and createUsage reads it to null
-- the FRC-robot-only usage fields for other kinds. Existing rows are all
-- 'frc_robot', so the new check validates immediately (no NOT VALID needed).
alter table battery drop constraint if exists battery_kind_check;
alter table battery add constraint battery_kind_check
  check (kind in ('frc_robot', 'ftc_robot', 'tool', 'camera', 'computer', 'other'));
