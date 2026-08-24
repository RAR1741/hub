-- Onshape right-panel integration (issue #95, v1).

-- Per-person Onshape OAuth tokens. Server-only (RLS zero-policy); the refresh
-- token lets the server mint fresh ~1h access tokens for months so a designer
-- connects Onshape once. Deleting the person removes their connection.
create table onshape_connection (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references person (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table onshape_connection enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

-- Onshape linkage on part. Identity of a CAD part is the triple
-- (document, element, part id); the URL is the deep link captured at create.
alter table part
  add column onshape_document_id text,
  add column onshape_element_id text,
  add column onshape_part_id text,
  add column onshape_url text;

-- Duplicate-link guard: one hub part per CAD part. Partial so the many
-- non-Onshape parts (all NULL) don't collide. Also the lookup index for
-- "which hub part is this CAD part?" (panel context matching). 23505 -> 409.
create unique index part_onshape_identity_unique
  on part (onshape_document_id, onshape_element_id, onshape_part_id)
  where onshape_part_id is not null;
