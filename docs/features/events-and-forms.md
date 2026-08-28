# Events and sign-up forms

Team Hub's **Events** are the sign-up/check-in surface for outreach, demos, and training that
happens outside normal build sessions. Any signed-in member can browse and sign up at `/events`;
mentors manage events and run check-in at `/admin/events`. An event can optionally have a **sign-up
form** attached — a small generic form-builder engine (`/admin/forms`) whose first (and currently
only) use is collecting richer answers than a plain "I'm in" at sign-up time.

## Member sign-up — `/events`

`src/app/events/page.tsx` lists events that haven't ended yet (`listUpcomingEvents` in
`src/lib/events.ts`), soonest first, with each member's current sign-up status
(`signedUpEventIds` in `src/lib/event-signups.ts`).

- **No form attached:** a plain **Sign up** / **Cancel sign-up** toggle button
  (`EventSignupButton.tsx`) calls `POST`/`DELETE /api/events/[id]/signup`.
- **Form attached, not yet signed up:** a **Sign up** button opens a modal
  (`EventSignupForm.tsx`) rendering the form's questions — attendance (Yes/Maybe/No) is always
  first, followed by whatever fields a mentor added. Submitting posts the answers to the same
  `POST /api/events/[id]/signup` route.
- **Already signed up:** the plain toggle button shows regardless of whether a form is attached,
  so canceling a form-based sign-up is still one click.

`POST /api/events/[id]/signup` (`src/app/api/events/[id]/signup/route.ts`) branches on
`event.formId`: with a form it validates and stores answers via `submitEventSignupResponse`
(`src/lib/form-responses.ts`); without one it falls through to the plain boolean
`signUpForEvent` (`src/lib/event-signups.ts`). `person_id` always comes from the session, never
the request body. Both directions are rate-limited (10/min per IP) and reject sign-up for an event
that has already ended.

Under the hood, a form-based sign-up still writes the plain `event_signup` row **and** a
`form_response` (+ `form_answer` rows), atomically, via the `submit_event_signup` Postgres
function — so canceling (`DELETE`) only needs to delete `event_signup`; `form_response` cascades
with it. See `supabase/migrations/20260825052410_event_signup_forms.sql`.

## Admin/mentor events — `/admin/events`, `/admin/events/[id]`

Mentor-and-up only (`hasRole(viewer.role, "mentor")`).

- **`/admin/events`** (`src/app/admin/events/page.tsx`) lists events split into **upcoming** and
  **previous** (collapsed), with an inline "New event" form (`EventForm.tsx`).
- **`/admin/events/[id]`** (`src/app/admin/events/[id]/page.tsx`) is the per-event roster page:
  edit-in-place event details, manual roster add, check-in/undo-check-in, and — when a form is
  attached — a **Responses** table of every submission, sorted by the attendance answer when the
  form has one.
- The **roster** (`listEventRoster` in `src/lib/event-signups.ts`) merges two sources: everyone
  who signed up (`event_signup`) and everyone checked in (`session` rows with
  `source = 'event'`), so a mentor's manual add shows up even without a prior sign-up.
- **Check-in** (`EventRosterActions.tsx` → `POST`/`DELETE /api/admin/events/[id]/checkin`) credits
  the person for the event's full duration (`starts_at`–`ends_at`) as one `session` row. The same
  route backs **"Add someone who didn't sign up"** (`ManualAddPerson`), which checks a person in
  directly without a sign-up record.
- **Google Calendar linking:** `EventForm.tsx` fetches unclaimed candidates from
  `GET /api/admin/events/gcal-candidates` (`listGcalCandidates` in `src/lib/events.ts` — reads
  the already-synced `meeting` table, no live Google call) and lets a mentor attach an event to
  one. A linked event's name/start/end are locked to the calendar event and kept in sync by the
  calendar sync job; `POST /api/admin/events/[id]/unlink` (`unlinkEvent`) detaches it, after which
  those fields become editable again. If the linked calendar event disappears, the event shows an
  unlink banner (`EventUnlinkBanner.tsx`) driven by an `event.gcal_missing` flag set by the sync
  job — see `docs/setup/google-calendar.md` for how that sync is configured.
- **Deleting an event** (`deleteEvent`) is blocked with a 409 once it has any check-in
  (`session`) history; `event_signup` rows are fine to lose and cascade-delete.

## Printable roster — `/admin/events/[id]/print`

A plain, print-styled attendee list (name, role, signed-up/checked-in) for handing to whoever's
running the door — see `src/app/admin/events/[id]/print/page.tsx`. It reuses `listEventRoster`
directly; it does not include form responses.

## Sign-up forms — `/admin/forms`, `/admin/forms/[id]`

A small generic form-builder (`src/lib/forms.ts`), mentor-and-up only. Today its only `kind` is
`event_signup` — an event optionally points at one form via `event.form_id` — but the schema
(`form` / `form_field` / `form_field_option` / `form_response` / `form_answer`) is written to grow
other kinds later.

- **`/admin/forms`** lists forms with their status and lets a mentor create one
  (`CreateFormForm` → `POST /api/admin/forms`). Every new form gets an **attendance question**
  (single-select: Yes / Maybe / No) automatically inserted as field 0 — mentors can't remove or
  edit it — and optionally a free-text **notes** field, both added server-side in `createForm` so
  a form can't be created without the attendance question. A form's `status` is `draft`,
  `published`, or `closed`, but nothing currently enforces status when attaching a form to an
  event or accepting submissions — `status` is informational only right now.
- **`/admin/forms/[id]`** edits a form's title/description/status
  (`FormSettingsForm` → `PATCH /api/admin/forms/[id]`) and its fields
  (`FormFieldEditor` → `POST /api/admin/forms/[id]/fields`,
  `DELETE /api/admin/forms/fields/[fieldId]`). Supported field types: single select, multi select,
  yes/no, short text, long text, scale — each optionally required, with choice types carrying a
  list of value/label options. Deleting a form is blocked with a 409 while any event still
  references it (`event.form_id` is a plain FK with no cascade).
- The **attendance field** is identified by `semantic_key = 'attending'` (`src/lib/forms.ts`),
  which is how the event roster page picks it out to sort responses and how a future consumer
  could special-case it without string-matching the label.

## Caveats

- A form of any status (including `draft`) can be picked in the event form's "Sign-up form"
  dropdown — there's no gate preventing an unfinished form from going live on an event.
- Editing a form's fields after people have already responded doesn't touch existing
  `form_answer` rows; a deleted field's old answers stay in the database but drop out of the
  Responses table (it only renders currently-existing fields).
- The event roster and the form-response Responses table are two separate tables on the same
  page — "Signed up" on the roster reflects `event_signup` only, not whether a form response was
  actually completed (the sign-up route writes both atomically, so in practice they stay in sync
  for member-initiated sign-ups; a mentor's manual add never creates a form response).
