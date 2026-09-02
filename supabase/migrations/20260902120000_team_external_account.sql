create table team_external_account (
  team_id uuid not null references team (id) on delete cascade,
  provider text not null check (provider in ('google', 'github')),
  -- Google: the email. GitHub: the login. Always lowercased, matching person_identity.
  identifier text not null check (identifier = lower(identifier)),
  -- Stable key for GitHub rows (logins can be renamed). Required for github, null for google.
  github_user_id bigint
    check ((provider = 'github') = (github_user_id is not null)),
  -- Human-readable grouping, e.g. "Programming bot". Shown in the admin UI.
  label text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, provider, identifier)
);

alter table team_external_account enable row level security;
grant all on team_external_account to service_role;
