-- supabase/migrations/20260813170000_time_import_source.sql
-- Historical time-sheet import tags its rows source='import' so a re-import is an
-- idempotent replace (delete this period's import rows, re-insert) that never
-- touches kiosk/manual/admin sessions. Excusals gain the same marker.

alter table session drop constraint if exists session_source_check;
alter table session add constraint session_source_check
  check (source in ('kiosk', 'manual', 'admin', 'import'));

alter table excusal add column source text not null default 'manual'
  check (source in ('manual', 'import'));
