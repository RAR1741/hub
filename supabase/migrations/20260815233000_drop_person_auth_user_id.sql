-- Contract step of the person_identity rollout (issue #32): all code now
-- reads/writes identities; the single-login column is retired.
alter table person drop column auth_user_id;
