create table team_slack_channel (
  team_id uuid not null references team (id) on delete cascade,
  slack_channel_id text not null,
  -- Optional friendly display name, e.g. "#frc".
  label text,
  primary key (team_id, slack_channel_id)
);

alter table team_slack_channel enable row level security;
grant all on team_slack_channel to service_role;
