-- Atomic form/field creation. Building a form is several inserts (the form
-- row, each field row, each field's options); done client-side a failure part
-- way through leaves a form with no attendance question, or a choice field
-- with zero options — shapes the rest of the forms code does not expect.
-- Same fix as submit_event_signup: one function = one transaction.

-- p_field keys mirror the form_field columns; options is an array of
-- { value, label, position }.
create or replace function add_form_field(p_form_id uuid, p_field jsonb)
returns uuid
language plpgsql
as $$
declare
  v_field_id uuid;
  v_option jsonb;
begin
  insert into form_field (form_id, label, help_text, type, required, position, semantic_key)
    values (
      p_form_id,
      p_field->>'label',
      p_field->>'help_text',
      p_field->>'type',
      coalesce((p_field->>'required')::boolean, false),
      (p_field->>'position')::int,
      p_field->>'semantic_key'
    )
    returning id into v_field_id;

  for v_option in select * from jsonb_array_elements(coalesce(p_field->'options', '[]'::jsonb)) loop
    insert into form_field_option (field_id, value, label, position)
      values (v_field_id, v_option->>'value', v_option->>'label', (v_option->>'position')::int);
  end loop;

  return v_field_id;
end;
$$;

create or replace function create_form(
  p_title text,
  p_description text,
  p_kind text,
  p_status text,
  p_created_by uuid,
  p_fields jsonb
) returns uuid
language plpgsql
as $$
declare
  v_form_id uuid;
  v_field jsonb;
begin
  insert into form (title, description, kind, status, created_by)
    values (p_title, p_description, p_kind, p_status, p_created_by)
    returning id into v_form_id;

  for v_field in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) loop
    perform add_form_field(v_form_id, v_field);
  end loop;

  return v_form_id;
end;
$$;

grant execute on function add_form_field(uuid, jsonb) to service_role;
grant execute on function create_form(text, text, text, text, uuid, jsonb) to service_role;
