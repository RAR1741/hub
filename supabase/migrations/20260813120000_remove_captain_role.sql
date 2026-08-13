-- Remove the `captain` role. Roles are now exactly: admin, mentor, student
-- (+ guest, which is app-level only and never stored).
--
-- `captain` ranked just above `student`, so remap any existing captains to
-- `student` (the closest remaining role) before dropping the value. Postgres
-- has no `ALTER TYPE ... DROP VALUE`, so swap the enum type out:
--   1. drop the column default (it references the old type),
--   2. rename the old type aside,
--   3. create the new type without `captain`,
--   4. re-point the column at the new type (text cast round-trips the values),
--   5. restore the default,
--   6. drop the old type.
-- person.role is the only user of person_role, so the swap is self-contained.

update person set role = 'student' where role = 'captain';

alter table person alter column role drop default;
alter type person_role rename to person_role_old;
create type person_role as enum ('admin', 'mentor', 'student');
alter table person
  alter column role type person_role using role::text::person_role;
alter table person alter column role set default 'student';
drop type person_role_old;
