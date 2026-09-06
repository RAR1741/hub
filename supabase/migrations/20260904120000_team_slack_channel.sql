create table team_slack_channel (
  team_id uuid not null references team (id) on delete cascade,
  -- Keep in sync with SLACK_CHANNEL_ID_RE in src/lib/teams.ts.
  slack_channel_id text not null check (slack_channel_id ~ '^[CG][A-Z0-9]{2,20}$'),
  -- Optional friendly display name, e.g. "#frc".
  label text check (label is null or char_length(label) <= 80),
  primary key (team_id, slack_channel_id)
);

alter table team_slack_channel enable row level security;
grant all on team_slack_channel to service_role;
