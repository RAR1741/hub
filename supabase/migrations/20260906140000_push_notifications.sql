-- Web Push: device subscriptions, per-person opt-in list, meeting reminder
-- dedupe marker, and the shared cron secret. All types are OFF by default
-- (notification_types defaults to empty).

create table push_subscription (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references person (id) on delete cascade,
  endpoint     text not null unique,   -- push service URL (also the natural key)
  p256dh       text not null,          -- client public key (base64url)
  auth         text not null,          -- client auth secret (base64url)
  user_agent   text,                   -- device list / debugging
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscription_person_idx on push_subscription (person_id);

alter table push_subscription enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on push_subscription to service_role;

-- Per-person opt-in list. Empty = every type off (the default).
alter table person add column notification_types text[] not null default '{}';

-- Dedupe marker so the meeting-reminder cron reminds each meeting once.
alter table meeting add column reminder_pushed_at timestamptz;

-- Shared secret for both push crons; set per-env in prod (empty never authorizes).
insert into app_setting (key, value) values ('push_cron_secret', '""')
on conflict (key) do nothing;
