# Event Sign-up Forms — Design Spec

> **Status:** Approved design, pre-implementation. Next step: `superpowers:writing-plans`.
> **Scope:** v1 = a minimal generic form engine whose **first and only consumer is event sign-up**. Deferred archetypes (Drive Team Interest, auditions, mentor sign-up, quiz) are tracked in a GitHub issue so the eventual full migration off Google Forms isn't lost.

## Background & goal

For several years the team ran outreach/competition/interest sign-ups through Google Forms (2022–2026 Drive folders). Reviewing every form/response pairing surfaced a small set of recurring archetypes; the single most-repeated is an **event sign-up** collecting: attending (Yes/Maybe/No), transport capability, a follow-on yes/no ("staying after?"), and a free-text "anything else?" — on top of identity/contact fields that the app's `person` profile already holds.

The app already models the hard parts:

- **`person`** — name, display name, role, grad year, email, phone, shirt size, dietary restrictions, bio, student id, active flag, team memberships. Every field a form used to re-ask about a member already lives here.
- **`event` + `event_signup` + `session`** — mentor-created events tied to a `period`, self-service sign-up (`event_signup` is a boolean person↔event join), and mentor-run check-in that credits attendance by inserting a `session` (`source='event'`). See `docs/superpowers/plans/2026-08-17-events-checkins.md`.

The gap: `event_signup` is **boolean only** — it records *that* you signed up, none of the per-response detail the Google Forms captured.

**Goal:** add a minimal, generic form engine and make event sign-up its first consumer, capturing the rich per-signup fields **without touching** the proven roster/check-in/attendance code, and structured so future form kinds plug in later without a schema rewrite.

## Decisions (locked during brainstorming)

1. **Architecture = hybrid.** Build a real generic form/field/response/answer engine (not per-feature typed columns, not a full arbitrary-form builder), with responses tied directly to a person and to events.
2. **First slice = event sign-up only.** The engine is designed only as deep as this slice needs; other archetypes are explicitly deferred.
3. **Approach A wiring.** `event_signup` stays the boolean "I'm in" record that roster/check-in/attendance already trust. Rich answers hang off it via a `form_response` (1:1), cascade-deleted on cancel. Chosen over "the response *is* the sign-up" (Approach B — too large a blast radius) and "just add typed columns" (Approach C — abandons the hybrid decision).
4. **No `profile_key` / prefill machinery.** Every `form_response` is tied to one `person_id`; anything the profile knows is a join away at read/export time. Forms therefore contain **only non-profile, form-specific fields**.
5. **`boolean` field type** (renders as a Yes/No toggle → `true`/`false`) instead of a `yes_no` string type — clearer for non-coder form builders and for reading data.
6. **No `email`/`phone` field types in v1** — contact info is always sourced from the `person` link.
7. **`attending = No` still creates a sign-up.** Every submission creates an `event_signup` + `form_response` 1:1 (including "No"); the roster groups by the `attending` value; student-facing copy reads the `attending` value so "No" shows as "you responded: not coming" rather than a checkmark.

## Data model

Four new tables + one nullable column on `event`. Existing `event`, `event_signup`, `session`, `person` are **unchanged**.

```
form                      -- a reusable form/template definition
  id            uuid pk
  title         text not null
  description   text
  kind          text not null default 'event_signup'   -- discriminator; check-constrained. v1 allows only 'event_signup'
  status        text not null default 'draft'          -- check: draft | published | closed
  created_by    uuid not null references person(id)
  created_at    timestamptz not null default now()

form_field                -- ordered fields on a form
  id            uuid pk
  form_id       uuid not null references form(id) on delete cascade
  label         text not null
  help_text     text
  type          text not null   -- check: single_select | multi_select | boolean | short_text | long_text | scale
  required      boolean not null default false
  position      int  not null
  semantic_key  text            -- optional app-meaningful role (e.g. 'attending','can_transport','notes'). null = plain custom field

form_field_option         -- choices for single_select / multi_select / scale fields
  id            uuid pk
  field_id      uuid not null references form_field(id) on delete cascade
  value         text not null
  label         text not null
  position      int  not null

form_response             -- one person's submission (1:1 with an event_signup row for the event_signup kind)
  id                uuid pk
  form_id           uuid not null references form(id)
  person_id         uuid not null references person(id)
  event_id          uuid references event(id)     -- set for event_signup kind; null for future kinds
  submitted_at      timestamptz not null default now()
  -- Composite FK ties the response to the boolean signup so it cascades on
  -- cancel. event_signup has NO surrogate id (its PK is (event_id, person_id)),
  -- so we reference that composite. MATCH SIMPLE = enforced only when BOTH
  -- columns are non-null; future non-event kinds leave event_id null.
  foreign key (event_id, person_id) references event_signup(event_id, person_id) on delete cascade
  -- one response per person per event (partial unique index; future kinds have null event_id)
  create unique index form_response_event_person_idx on form_response(event_id, person_id) where event_id is not null

form_answer               -- EAV answer store; one row per scalar, multiple rows per multi_select
  id            uuid pk
  response_id   uuid not null references form_response(id) on delete cascade
  field_id      uuid not null references form_field(id)
  value         text        -- option value | 'true'/'false' | number-as-text | free text
  unique(response_id, field_id, value)

event
  + form_id     uuid references form(id)   -- NEW, nullable. null = today's plain boolean sign-up (backward compatible)
```

Notes:

- **Reusable templates:** many events → one `form` (build the "Standard Outreach Sign-up" once, attach everywhere). `event.form_id` nullable → existing/simple events keep working with no form at all.
- **Approach A intact:** `event_signup` untouched; rich answers live in `form_response`/`form_answer` and cascade away on cancel.
- **Future-proofing that costs nothing now:** the `kind` discriminator and `semantic_key` are exactly what lets Drive Team Interest / quiz reuse these tables later without schema churn.
- **Options are relational**, not jsonb, matching the codebase's typed grain and giving answers referential meaning.
- **RLS enabled, zero policies** on all five new tables (service-role-only, per repo convention); a `service_role` GRANT migration ships with them so fresh DBs don't 42501.

## Field types (v1)

| type | renders as | answer stored | covers |
|---|---|---|---|
| `single_select` | radio / dropdown | one option value | "Attending? Yes/Maybe/No", "which to attend?" |
| `multi_select` | checkboxes | N answer rows | "which competitions/days" |
| `boolean` | Yes/No toggle | `'true'` / `'false'` | "can you transport?", "staying after?" |
| `short_text` | single-line | text | misc short answers |
| `long_text` | textarea | text | "anything else we need to know?" |
| `scale` | 1–N or Not/Somewhat/Very | option value | present for later kinds (Drive Team); harmless in v1 |

Deferred field types (not in v1): grid/matrix, date, time-slot picker, file upload, graded-quiz question types.

## Semantic keys

The small controlled vocabulary letting generic fields drive real app behavior. `form_field.semantic_key` is null (plain custom field) or one of:

- `attending` — a `single_select` whose value the roster reads to group Coming / Maybe / Not-coming, and which student-facing copy reads for its "you responded…" state.
- `can_transport` — a `boolean` (or `single_select`) the roster surfaces for logistics (who can carry the robot/students).
- `notes` — the "anything else?" `long_text`.

The vocabulary is enforced in **app code** (a TS union), not a DB constraint, so adding one later is a code change, not a migration.

## Sign-up submission flow

- **Attaching a form:** a mentor builds/reuses a `form` (kind `event_signup`) and sets `event.form_id`. No form attached → sign-up stays today's one-click boolean (fully backward compatible).
- **Submitting** (self-scoped; `person_id` forced from the viewer, never the request body) — one transaction:
  1. insert `event_signup(event_id, person_id)` via the existing `signUpForEvent` path, unchanged.
  2. insert `form_response(form_id, person_id, event_id)` + the `form_answer` rows.

  Steps 1–2 run atomically inside a `submit_event_signup(...)` Postgres function invoked via `.rpc()` (same pattern as the existing `merge_person` / `close_stale_sessions` functions), so a partial submission can't leave a signup without its answers.
- Answers are validated server-side against each field's type / `required` / options **before** the transaction.
- **Cancelling** a sign-up cascades the response + answers away (existing `cancelEventSignup`).
- `listEventRoster`, `signedUpEventIds`, and `checkInPerson` need **no changes**; a new read joins responses so mentors see the extra columns.
- **`attending = No`:** creates the `event_signup` + `form_response` like any submission (decision 7); the roster groups by the `attending` value; student "you're signed up" copy reads the `attending` value.

## Lib surface, API routes & auth

Following the existing seam (pure validators + DB logic in `src/lib/`, mutations via Route Handlers gated by `withRole`/self-scope, Vitest fake-client injection).

**New lib modules**

- `src/lib/forms.ts` — form/field definitions.
  - Pure: `parseFormInput`, `parseFieldInput`, `validateAnswers(fields, submitted)` (type/required/option checks — the heart; heavily unit-tested).
  - DB: `createForm`, `getFormWithFields`, `listForms`, `updateForm`, `deleteForm`, field/option CRUD.
- `src/lib/form-responses.ts` — `submitEventSignupResponse` (the transaction above), `getResponse`, `listEventResponses(eventId)` (roster join: person + answers). Cancel is handled by the existing `cancelEventSignup` cascade.
- `src/lib/events.ts` — extend `EventInput` / `parseEventInput` with an optional `formId`; validate it references an existing `event_signup`-kind form.

**Routes**

- `POST/PATCH/DELETE /api/admin/forms[/[id]]` and field/option sub-routes — `withRole("mentor")`, the form builder.
- Event page loader returns the attached form + fields for rendering.
- `POST /api/events/[id]/signup` — **extended, not replaced:** same self-scoped auth as today; now accepts an optional `answers` payload and runs the transaction. `person_id` always forced from `viewer.person.id`.
- `DELETE /api/events/[id]/signup` — unchanged (cascade removes the response).

**Auth summary**

- Build/edit/delete forms & fields → `mentor`+.
- Submit / cancel a response → any signed-in viewer, self-scoped (mirrors `POST /api/excusal-requests` and today's signup).
- Read others' responses (roster/export) → `mentor`+; a student can read only their own.

Answer validation lives server-side in `validateAnswers`; client rendering is convenience only — the route re-validates every answer against the field definitions before writing.

## Migration

One migration file, `supabase db push` to prod (flagged in the task report per repo convention):

- Create `form`, `form_field`, `form_field_option`, `form_response`, `form_answer`; add `event.form_id`.
- Create the `submit_event_signup(...)` Postgres function (atomic signup + response + answers insert; raises mapped error codes like `merge_person` does).
- `enable row level security` on all five new tables with **zero policies**; a `grant` migration for `service_role` (or fresh DBs 42501).
- Check constraints: `form.kind`, `form.status`, `form_field.type`; the unique constraints above.
- Never edit an applied migration in place — corrections are new migration files.

## Testing

Vitest, fake-client injection style, all green before PR:

- **Pure:** `validateAnswers` (required-missing, wrong type, bad option, `boolean` coercion, `multi_select` cardinality), `parseFormInput`, `parseFieldInput`, extended `parseEventInput` (formId).
- **DB logic:** `submitEventSignupResponse` (transaction success; roster-unaffected; cascade-on-cancel), `getFormWithFields`, `listEventResponses`, form/field CRUD.
- **Regression:** existing `event-signups.test.ts` / `events.test.ts` stay green (proves Approach A left them untouched).
- `./dev npm run lint && typecheck && test`, plus one e2e happy-path (attach form → sign up with answers → mentor sees them on the roster).

## Out of scope for v1 (tracked for the full Google Forms migration)

Each is a later `kind` or field-type addition; the schema already leaves room. Tracked in [issue #181](https://github.com/RAR1741/hub/issues/181) so the full migration isn't lost:

- **Form kinds:** Drive Team Interest (position grid + per-event attendance + acknowledgment — brand new), award/Impact auditions, mentor sign-up (program/availability/location multi-selects), graded Safety Quiz.
- **Field types:** grid/matrix, date, time-slot picker, file upload, quiz-scored questions (auto-score, matching/ordering, acronym).
- **Engine features:** profile writeback, form versioning, conditional/branching logic, non-member (public) submissions, drag-and-drop builder polish, standardized shared option-sets across forms.
