-- Parts domain (issues #8-#11), ported from Team254/cheesy-parts.
-- Projects group parts; parts form a tree (assemblies contain parts and
-- sub-assemblies) and carry a 20-stage manufacturing status. The public
-- shop dashboard (/shop) reads these tables; all writes are mentor+.

create table project (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Prefix of every rendered part number (e.g. "RA2026" -> RA2026-A-0100).
  -- Renaming it retroactively renames all the project's parts — numbers are
  -- derived at render time, never stored formatted (matches cheesy-parts).
  part_number_prefix text not null unique,
  created_at timestamptz not null default now()
);

alter table project enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

create table part (
  id uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: deleting a project with parts must 409 (cheesy
  -- orphaned them; we guard). deleteProject() checks first for a clean 409,
  -- the FK is the backstop — same pattern as session.event_id / deleteEvent().
  project_id uuid not null references project (id) on delete restrict,
  -- Self-FK tree. NULL = top-level (cheesy-parts used a 0 sentinel — any data
  -- import must translate 0 -> NULL). restrict = "can't delete assembly with
  -- children"; deletePart() checks first and returns 409.
  parent_part_id uuid references part (id) on delete restrict,
  part_number integer not null,
  type text not null check (type in ('part', 'assembly')),
  name text not null,
  status text not null default 'designing' check (status in (
    'designing', 'material', 'ordered', 'drawing', 'ready',
    'cnc', 'laser', 'lathe', 'mill', 'printer', 'router',
    'manufacturing', 'outsourced', 'welding', 'scotchbrite',
    'anodize', 'powder', 'coating', 'assembly', 'done')),
  priority integer not null default 1 check (priority in (0, 1, 2)),
  notes text,
  source_material text,
  have_material boolean not null default false,
  quantity text,      -- free text in cheesy-parts ("4", "2 + spares"); kept as text
  cut_length text,    -- free text in cheesy-parts; kept as text
  drawing_created boolean not null default false,
  created_at timestamptz not null default now(),
  -- Numbers are unique per project across BOTH types (cheesy migration 009).
  -- Also the backstop for the non-transactional number-allocation race —
  -- createPart() retries once on 23505. Doubles as the (project_id, ...)
  -- index for the dashboard/list "all parts of project X" queries.
  constraint part_number_unique_per_project unique (project_id, part_number)
);

-- Children lookups: delete guard ("does this assembly have children?") and
-- the sibling-max query in number allocation.
create index part_parent_idx on part (parent_part_id);

alter table part enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
