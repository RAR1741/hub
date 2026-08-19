-- Admin "view as" / masquerade sessions (issue #34). An admin can view the
-- app as another (non-admin) person for diagnostics — this table is both the
-- source of truth for "is a masquerade currently active" (ended_at is null)
-- and the audit trail (who, as whom, when started/stopped). Masquerade is
-- read-only end-to-end; enforced in application code (src/lib/api.ts).
create table masquerade_session (
  id uuid primary key default gen_random_uuid(),
  admin_person_id uuid not null references person (id) on delete cascade,
  target_person_id uuid not null references person (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Fast lookup of "does this admin already have an active session" (used to
-- auto-end a stale one before starting a new one) and of the active session
-- referenced by the masquerade cookie.
-- Unique partial index to enforce single active session per admin;
-- prevents race conditions from creating multiple concurrent sessions.
create unique index masquerade_session_admin_active_unique
  on masquerade_session (admin_person_id) where ended_at is null;

-- RLS zero-policy like every table: default-deny; service role bypasses.
alter table masquerade_session enable row level security;

grant all on masquerade_session to service_role;
