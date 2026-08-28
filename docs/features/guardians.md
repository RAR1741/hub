# Guardians

Each person can have one or more **guardians** on file — a parent/contact record with a
relationship (Mother, Father, Guardian, …), separate from the person's own login identity. The
same guardian record can be linked to more than one student, which is how siblings sharing a
parent are represented in the roster.

## How it works

- Guardians live in their own `guardian` table; `person_guardian` is the join table that links a
  guardian to a person with a `relationship` string. Deleting the join row unlinks a guardian from
  one student; deleting the guardian row cascades and removes it from every student it's linked to.
- **Sibling case:** a guardian isn't owned by one student. **Link existing** searches guardians by
  name (`searchGuardians()` in `src/lib/guardians.ts`) and upserts a `person_guardian` row for the
  selected guardian, so the same parent can end up linked to two or more students without
  duplicating their contact info.
- Guardian email isn't lowercased/normalized like a person's login email (`parseGuardianInput()`)
  — guardians aren't login identities, so it's stored as typed.

## Visibility

- **Admins** get full CRUD on `/admin/people/[id]` via `PersonGuardians`
  (`src/components/PersonGuardians.tsx`): add a new guardian, edit one, unlink one from this
  student, link an existing guardian to this student, or delete a guardian outright (which removes
  it everywhere).
- **Mentors and admins** get a read-only Guardians section on the public profile
  `/people/[id]` — name, relationship, email, phone, employer. Gated by `hasRole(viewer.role,
  "mentor")` in `src/app/people/[id]/page.tsx`.
- **Students do not see the Guardians section at all, even on their own profile** — the role
  check has no student-owns-this-profile exception, unlike the rest of the page. Confirmed by
  `e2e/guardian-crud.spec.ts`.

## Using it

1. On `/admin/people/[id]`, open **Add new guardian** to create one from scratch (first/last name
   required; email, phone, employer, relationship optional), or open **Link existing guardian**,
   search by name, pick a match, and set the relationship.
2. Existing guardian rows show **Edit**, **Unlink**, and **Delete guardian** — Unlink only removes
   this student's link; Delete removes the guardian record and every link to it (the UI confirms
   with a warning naming that scope before sending the request).

## APIs

- `POST /api/admin/people/[id]/guardians` — create a guardian and link it to `id` in one step
  (`createGuardianForPerson()`).
- `POST /api/admin/people/[id]/guardians/link` — link an existing guardian to `id`
  (`linkGuardian()`, upsert on `(person_id, guardian_id)` so re-linking just updates the
  relationship).
- `DELETE /api/admin/people/[id]/guardians/[guardianId]` — unlink only (`unlinkGuardian()`).
- `GET /api/admin/guardians/search?q=` — name search for the link-existing flow
  (`searchGuardians()`, top 10 matches).
- `PATCH` / `DELETE /api/admin/guardians/[guardianId]` — edit or hard-delete a guardian record
  (`updateGuardian()`, `deleteGuardian()`).

All of the above are `withRole("admin", …)`. Source: `src/lib/guardians.ts`.

## Caveats

- No client-side confirm on **Add new guardian** or **Link existing** beyond the required fields —
  only **Delete guardian** prompts, since it's the only irreversible, multi-student-affecting
  action.
- A guardian with no links to any student still exists in the table (e.g. after the last Unlink) —
  there's no cleanup job; it just stops showing up on any profile until linked again.
