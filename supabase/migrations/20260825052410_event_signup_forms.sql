-- Generic form engine, first consumer = event sign-up. See
-- docs/superpowers/specs/2026-08-25-event-signup-forms-design.md (Approach A).
-- event_signup stays the boolean "I'm in" record; rich answers hang off it
-- via form_response (composite FK to event_signup, cascade-on-cancel).

create table form (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  kind text not null default 'event_signup',
  status text not null default 'draft',
  created_by uuid not null references person (id),
  created_at timestamptz not null default now(),
  constraint form_kind_check check (kind in ('event_signup')),
  constraint form_status_check check (status in ('draft', 'published', 'closed'))
);

create table form_field (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references form (id) on delete cascade,
  label text not null,
  help_text text,
  type text not null,
  required boolean not null default false,
  position int not null,
  semantic_key text,
  constraint form_field_type_check check (
    type in ('single_select', 'multi_select', 'boolean', 'short_text', 'long_text', 'scale')
  )
);
create index form_field_form_idx on form_field (form_id, position);

create table form_field_option (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references form_field (id) on delete cascade,
  value text not null,
  label text not null,
  position int not null
);
create index form_field_option_field_idx on form_field_option (field_id, position);

create table form_response (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references form (id),
  person_id uuid not null references person (id),
  event_id uuid references event (id),
  submitted_at timestamptz not null default now(),
  -- Ties the response to the boolean signup so it cascades on cancel.
  -- event_signup has no surrogate id; its PK is (event_id, person_id).
  -- MATCH SIMPLE: enforced only when BOTH columns are non-null.
  constraint form_response_signup_fk
    foreign key (event_id, person_id)
    references event_signup (event_id, person_id) on delete cascade
);
-- One response per person per event (future non-event kinds leave event_id null).
create unique index form_response_event_person_idx
  on form_response (event_id, person_id) where event_id is not null;
create index form_response_form_idx on form_response (form_id);

create table form_answer (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references form_response (id) on delete cascade,
  field_id uuid not null references form_field (id),
  value text,
  constraint form_answer_unique unique (response_id, field_id, value)
);
create index form_answer_response_idx on form_answer (response_id);

alter table event add column form_id uuid references form (id);

alter table form enable row level security;
alter table form_field enable row level security;
alter table form_field_option enable row level security;
alter table form_response enable row level security;
alter table form_answer enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

grant select, insert, update, delete on form, form_field, form_field_option,
  form_response, form_answer to service_role;

-- Atomic sign-up: create the boolean signup, the response, and its answers in
-- one transaction. Mirrors merge_person's raise-with-errcode convention.
-- P0100 = event not open (missing or already ended).
create or replace function submit_event_signup(
  p_event_id uuid,
  p_person_id uuid,
  p_form_id uuid,
  p_answers jsonb
) returns uuid
language plpgsql
as $$
declare
  v_response_id uuid;
  v_answer jsonb;
begin
  if not exists (select 1 from event where id = p_event_id and ends_at > now()) then
    raise exception 'event not open' using errcode = 'P0100';
  end if;

  insert into event_signup (event_id, person_id) values (p_event_id, p_person_id);

  insert into form_response (form_id, person_id, event_id)
    values (p_form_id, p_person_id, p_event_id)
    returning id into v_response_id;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    insert into form_answer (response_id, field_id, value)
      values (v_response_id, (v_answer->>'field_id')::uuid, v_answer->>'value');
  end loop;

  return v_response_id;
end;
$$;

grant execute on function submit_event_signup(uuid, uuid, uuid, jsonb) to service_role;
