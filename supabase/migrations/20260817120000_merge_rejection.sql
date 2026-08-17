-- Dismissed duplicate-pair suggestions (issue: reject/deny merge).
-- Keyed on the ordered (a, b) id pair — same a < b rule as DupCandidate —
-- so one row uniquely suppresses a pair regardless of scan order.
-- Cascade-deletes when either person is removed; rejected_by nulls on admin removal.

create table person_merge_rejection (
  a            uuid not null references person (id) on delete cascade,
  b            uuid not null references person (id) on delete cascade,
  rejected_by  uuid references person (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (a, b),
  constraint rejection_order check (a < b)
);

create index person_merge_rejection_a on person_merge_rejection (a);
create index person_merge_rejection_b on person_merge_rejection (b);

alter table person_merge_rejection enable row level security;
-- Default-deny; all access via service role.
grant all on person_merge_rejection to service_role;
