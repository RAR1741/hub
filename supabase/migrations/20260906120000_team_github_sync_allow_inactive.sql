-- Per-team flag: when true, GitHub team reconcile keeps inactive members
-- (alumni) in the expected set instead of surfacing them as "would be removed".
alter table team add column if not exists github_sync_allow_inactive boolean not null default false;
-- team is already granted to service_role; new column needs no grant.
