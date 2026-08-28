# CSV roster import

`/admin/people/import` (linked from `/admin/people`, `withRole("admin")`-gated) lets an admin bulk
create/update the roster from a CSV.

## Columns

Header (case-insensitive, any order): `first_name,last_name,email,role,grad_year,
student_id_number`. Only `first_name` and `last_name` are required.

- A blank `role` defaults to `student`.
- `grad_year`, if given, must be an integer 2000–2100 (same bound the admin person form enforces).
- `email`, if given, is lowercased and must match a basic `local@domain.tld` shape.
- Unknown columns are ignored — noted as a non-fatal warning, not an error.
- A trailing all-blank line (common in spreadsheet exports) is skipped silently.

Download a starter file (header row only) from the **Download template** link — `GET
/api/admin/people/import` (also `withRole("admin")`), `Content-Disposition: attachment;
filename="roster-template.csv"`.

## Matching and field updates

Each row is matched against the existing roster (`findPersonForRosterRow`, `src/lib/people.ts`) by:

1. **email** — looked up against `person_identity`, i.e. *any* linked sign-in email for a person,
   not just their primary. CSV emails are lowercased at parse time, matching how emails are always
   stored.
2. **student_id_number** — exact match, if no email match.

A match calls `updatePersonRosterFields`, which touches **only** the CSV-supplied columns —
`first_name`, `last_name`, and (when the cell was non-blank) `email`, `role`, `grad_year`,
`student_id_number`. Everything else (phone, bio, shirt size, dietary notes, display name, active
flag) is left alone; a blank cell is treated as "leave the existing value alone," never as "clear
this field." A defaulted (not explicitly stated) `role` cell is never written on an update, so a
blank `role` column can't demote an existing mentor/admin back to student — only a CSV row that
explicitly says `role=student` can do that. Writing `email` on an existing person fires the
`person_identity` mirror trigger, renaming their primary sign-in email (or promoting a matching
secondary) rather than adding a new identity.

No match calls `createPerson` with the row's fields (`isActive: true`, everything not in the CSV
left `null`).

## Server-side re-validation and results

`POST /api/admin/people/import` (`withRole("admin")`) takes `{ csv: string }` and re-parses/
re-validates the raw text server-side — it never trusts the browser's client-side preview. The pure
parser (`parseRosterCsv`, `src/lib/roster-import.ts`) also flags **in-file** duplicate emails and
duplicate student IDs as per-row errors (every row sharing the key, not just the second) before
anything reaches the database — there's no safe way to pick a winner among duplicates, so none of
them import.

The response is a per-row summary:

```json
{ "created": 0, "updated": 0, "skipped": 0, "errors": [{ "line": 3, "message": "..." }], "results": [...] }
```

A unique-constraint violation on insert/update (email or student ID already used by another person)
comes back as a per-row `409`-derived error message, never a bare 500. `results` and `errors` are
sorted by source line number.
