-- Link a hub person to their Slack user id (v1: read/match from users.list).
-- person is already granted to service_role; a new column needs no grant.
alter table person add column if not exists slack_user_id text unique;
