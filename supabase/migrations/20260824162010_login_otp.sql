-- Email OTP login codes. One row per issued code; consumed_at marks it used,
-- attempts tracks failed guesses (capped in application code), expires_at is
-- the hard cutoff. Verification/rate-limiting logic lives in src/lib/otp.ts.
create table login_otp (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index login_otp_person_id_idx on login_otp (person_id);

-- RLS zero-policy like every table: default-deny; service role bypasses.
alter table login_otp enable row level security;

grant all on login_otp to service_role;
