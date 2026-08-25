-- Badges: named credentials/training marks that mentors+ award to people,
-- optionally scoped to a team and optionally self-awardable by team members.
-- Narrowed MVP of the "learnings management" idea (issue #5): one flat badge
-- entity with an optional free-text category instead of GatherPack's separate
-- BadgeType table — "types" are just a label here, not a thing to CRUD.

create table badge (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  description text,
  color text not null default '#6b7280',
  team_id uuid references team (id) on delete cascade,
  allow_self_award boolean not null default false,
  created_by uuid not null references person (id),
  created_at timestamptz not null default now(),
  constraint badge_color_is_hex check (color ~ '^#[0-9a-fA-F]{6}$')
);

create unique index badge_name_unique_idx on badge (lower(name));
create index badge_team_idx on badge (team_id) where team_id is not null;

alter table badge enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

create table badge_award (
  id uuid primary key default gen_random_uuid(),
  badge_id uuid not null references badge (id) on delete cascade,
  person_id uuid not null references person (id) on delete cascade,
  awarded_by uuid not null references person (id),
  note text,
  awarded_at timestamptz not null default now(),
  unique (badge_id, person_id)
);

create index badge_award_person_idx on badge_award (person_id);

alter table badge_award enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
