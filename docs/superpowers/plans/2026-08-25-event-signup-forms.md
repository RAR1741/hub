# Event Sign-up Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal generic form engine and make event sign-up its first consumer, so a member's sign-up can carry rich per-response fields (attending status, transport capability, notes) without touching the proven roster/check-in/attendance code.

**Architecture:** Approach A — `event_signup` stays the boolean "I'm in" join that roster/check-in already trust; rich answers hang off it via a `form_response` (composite-FK'd to `event_signup(event_id, person_id)`, cascade-on-cancel) plus an EAV `form_answer` store. New tables: `form`, `form_field`, `form_field_option`, `form_response`, `form_answer`; new nullable `event.form_id`. Submit is atomic via a `submit_event_signup(...)` Postgres function invoked with `.rpc()` (same pattern as `merge_person`). Pure validators + DB logic live in `src/lib/`, tested Vitest fake-client style; mutations go through Route Handlers gated by `withRole("mentor")` (builder) or self-scoped viewer (submit).

**Tech Stack:** Next.js App Router, Supabase/Postgres, `@supabase/supabase-js`, Vitest, TypeScript strict, Tailwind design-system classes, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-25-event-signup-forms-design.md`

## Global Constraints

- Everything runs in the dev container via `./dev`. **Git runs on the HOST** — commit from the host shell, not inside the container. Push to origin immediately after every commit.
- All timestamps `timestamptz`, stored UTC; UUID PKs via `gen_random_uuid()`.
- **RLS enabled on every new table with ZERO policies** — service-role-only; add a `grant` for `service_role` in the same migration or fresh DBs 42501.
- **Never edit an applied migration in place** — corrections are new migration files.
- Roles: `admin` > `mentor` > `student` > `guest`. Form build/edit/delete → `withRole("mentor")`. Submit/cancel → any signed-in viewer, self-scoped (`person_id` forced from `viewer.person.id`, never the request body) — mirrors the existing `POST /api/events/[id]/signup`.
- Reuse existing helpers — do not reimplement: `getDb` (`src/lib/db.ts`), `withRole` (`src/lib/api.ts`), `getViewer` (`src/lib/viewer.ts`), `hasRole` (`src/lib/authz.ts`), `reqString`/`optString`/`reqUuid`/`optInt` (`src/lib/validate.ts`), `displayName` (`src/lib/people.ts`), `signUpForEvent`/`cancelEventSignup`/`listEventRoster` (`src/lib/event-signups.ts`), `getEvent` (`src/lib/events.ts`), `createRateLimiter`/`clientIp` (`src/lib/rate-limit.ts`).
- Field types (the `form_field.type` check + TS union): `single_select | multi_select | boolean | short_text | long_text | scale`.
- Semantic keys (TS union, app-enforced, NOT a DB constraint): `attending | can_transport | notes` (nullable).
- Match the design system: `.card`/`.btn`/`.btn-primary`/`.btn-secondary`/`.table`/`.tablewrap`/`.page-head`/`.sub`, plain semantic HTML.
- All Vitest tests stay green; add tests for every new pure/DB function using the fake-client-injection style (see `src/lib/event-signups.test.ts`).
- **New migration must be applied to prod** via `supabase db push` — flag it in the task report; the controller applies it.
- `[id]` routes: `type Ctx = { params: Promise<{ id: string }> }` + `await context.params`.

---

### Task 1: Migration — tables, indexes, RLS, grants, submit function

**Files:**
- Create: `supabase/migrations/<timestamp>_event_signup_forms.sql` (via `./dev npx supabase migration new event_signup_forms`)

**Interfaces:**
- Produces: tables `form`, `form_field`, `form_field_option`, `form_response`, `form_answer`; column `event.form_id`; function `submit_event_signup(uuid, uuid, uuid, jsonb) returns uuid`.

- [ ] **Step 1: Generate the migration file**

Run: `./dev npx supabase migration new event_signup_forms`

- [ ] **Step 2: Write the migration**

```sql
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
```

- [ ] **Step 3: Apply locally and verify**

Run: `./dev npm run db:reset`
Expected: reset completes with no error; the new tables and function exist.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(forms): schema — form engine tables + submit_event_signup fn"
git push
```

Report to the controller: **migration must be `supabase db push`'d to prod.**

---

### Task 2: Types — row/domain types + fromRow helpers

**Files:**
- Modify: `src/lib/types.ts`
- Test: `src/lib/types.test.ts` (append; file already exists — check first, create if absent)

**Interfaces:**
- Produces:
  - `FormFieldType = 'single_select' | 'multi_select' | 'boolean' | 'short_text' | 'long_text' | 'scale'`
  - `SemanticKey = 'attending' | 'can_transport' | 'notes'`
  - `FormRow`/`Form`, `FormFieldRow`/`FormField`, `FormFieldOptionRow`/`FormFieldOption`, `FormResponseRow`/`FormResponse`, `FormAnswerRow`/`FormAnswer`
  - `formFromRow`, `formFieldFromRow`, `formFieldOptionFromRow`, `formResponseFromRow`, `formAnswerFromRow`
  - `EventRow` gains `form_id: string | null`; `Event` gains `formId: string | null`; `eventFromRow` maps it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/types.test.ts (append)
import { describe, expect, test } from "vitest";
import { formFieldFromRow, eventFromRow } from "./types";

describe("formFieldFromRow", () => {
  test("maps snake_case row to camelCase domain", () => {
    const field = formFieldFromRow({
      id: "f1", form_id: "form1", label: "Attending?", help_text: null,
      type: "single_select", required: true, position: 0, semantic_key: "attending",
    });
    expect(field).toEqual({
      id: "f1", formId: "form1", label: "Attending?", helpText: null,
      type: "single_select", required: true, position: 0, semanticKey: "attending",
    });
  });
});

describe("eventFromRow form_id", () => {
  test("maps form_id -> formId", () => {
    const row = {
      id: "e1", period_id: "pd1", name: "Demo", location: null, description: null,
      starts_at: "2099-01-01T18:00:00Z", ends_at: "2099-01-01T20:00:00Z",
      created_by: "m1", created_at: "2020-01-01T00:00:00Z", gcal_event_id: null,
      gcal_missing: false, form_id: "form1",
    };
    expect(eventFromRow(row as never).formId).toBe("form1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev npx vitest run src/lib/types.test.ts`
Expected: FAIL (`formFieldFromRow` not exported; `formId` missing).

- [ ] **Step 3: Add the types + helpers**

Add to `src/lib/types.ts` (place near the existing Event types; match the file's existing `*Row` / `*FromRow` style):

```ts
export type FormFieldType =
  | "single_select" | "multi_select" | "boolean" | "short_text" | "long_text" | "scale";

export type SemanticKey = "attending" | "can_transport" | "notes";

export type FormRow = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  created_by: string;
  created_at: string;
};
export type Form = {
  id: string; title: string; description: string | null;
  kind: string; status: string; createdBy: string; createdAt: string;
};
export function formFromRow(r: FormRow): Form {
  return {
    id: r.id, title: r.title, description: r.description, kind: r.kind,
    status: r.status, createdBy: r.created_by, createdAt: r.created_at,
  };
}

export type FormFieldRow = {
  id: string; form_id: string; label: string; help_text: string | null;
  type: FormFieldType; required: boolean; position: number; semantic_key: string | null;
};
export type FormField = {
  id: string; formId: string; label: string; helpText: string | null;
  type: FormFieldType; required: boolean; position: number; semanticKey: string | null;
};
export function formFieldFromRow(r: FormFieldRow): FormField {
  return {
    id: r.id, formId: r.form_id, label: r.label, helpText: r.help_text,
    type: r.type, required: r.required, position: r.position, semanticKey: r.semantic_key,
  };
}

export type FormFieldOptionRow = { id: string; field_id: string; value: string; label: string; position: number };
export type FormFieldOption = { id: string; fieldId: string; value: string; label: string; position: number };
export function formFieldOptionFromRow(r: FormFieldOptionRow): FormFieldOption {
  return { id: r.id, fieldId: r.field_id, value: r.value, label: r.label, position: r.position };
}

export type FormResponseRow = {
  id: string; form_id: string; person_id: string; event_id: string | null; submitted_at: string;
};
export type FormResponse = {
  id: string; formId: string; personId: string; eventId: string | null; submittedAt: string;
};
export function formResponseFromRow(r: FormResponseRow): FormResponse {
  return { id: r.id, formId: r.form_id, personId: r.person_id, eventId: r.event_id, submittedAt: r.submitted_at };
}

export type FormAnswerRow = { id: string; response_id: string; field_id: string; value: string | null };
export type FormAnswer = { id: string; responseId: string; fieldId: string; value: string | null };
export function formAnswerFromRow(r: FormAnswerRow): FormAnswer {
  return { id: r.id, responseId: r.response_id, fieldId: r.field_id, value: r.value };
}
```

Then extend the EXISTING `EventRow` type (add `form_id: string | null;`), the `Event` type (add `formId: string | null;`), and `eventFromRow` (add `formId: row.form_id ?? null,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `./dev npx vitest run src/lib/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/types.test.ts
git commit -m "feat(forms): row/domain types + fromRow helpers; event.formId"
git push
```

---

### Task 3: `forms.ts` — pure validators

**Files:**
- Create: `src/lib/forms.ts`
- Test: `src/lib/forms.test.ts`

**Interfaces:**
- Consumes: `FormFieldType`, `SemanticKey`, `FormField`, `FormFieldOption` (Task 2); `reqString`, `optString`, `optInt` (validate.ts).
- Produces:
  - `type FieldWithOptions = FormField & { options: FormFieldOption[] }`
  - `type SubmittedAnswer = { fieldId: string; values: string[] }`
  - `type AnswerRow = { field_id: string; value: string }`
  - `parseFormInput(body): { title: string; description: string | null; kind: string; status: string } | null`
  - `parseFieldInput(body): { label: string; helpText: string | null; type: FormFieldType; required: boolean; position: number; semanticKey: string | null; options: { value: string; label: string; position: number }[] } | null`
  - `validateAnswers(fields: FieldWithOptions[], submitted: SubmittedAnswer[]): { ok: true; answers: AnswerRow[] } | { ok: false }`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/forms.test.ts
import { describe, expect, test } from "vitest";
import { parseFieldInput, parseFormInput, validateAnswers, type FieldWithOptions } from "./forms";

const attending: FieldWithOptions = {
  id: "f_att", formId: "form1", label: "Attending?", helpText: null,
  type: "single_select", required: true, position: 0, semanticKey: "attending",
  options: [
    { id: "o1", fieldId: "f_att", value: "yes", label: "Yes", position: 0 },
    { id: "o2", fieldId: "f_att", value: "no", label: "No", position: 1 },
  ],
};
const transport: FieldWithOptions = {
  id: "f_tr", formId: "form1", label: "Can transport?", helpText: null,
  type: "boolean", required: false, position: 1, semanticKey: "can_transport", options: [],
};
const comps: FieldWithOptions = {
  id: "f_c", formId: "form1", label: "Which comps?", helpText: null,
  type: "multi_select", required: false, position: 2, semanticKey: null,
  options: [
    { id: "c1", fieldId: "f_c", value: "columbus", label: "Columbus", position: 0 },
    { id: "c2", fieldId: "f_c", value: "state", label: "State", position: 1 },
  ],
};

describe("validateAnswers", () => {
  test("accepts a valid submission and flattens multi_select", () => {
    const r = validateAnswers([attending, transport, comps], [
      { fieldId: "f_att", values: ["yes"] },
      { fieldId: "f_tr", values: ["true"] },
      { fieldId: "f_c", values: ["columbus", "state"] },
    ]);
    expect(r).toEqual({
      ok: true,
      answers: [
        { field_id: "f_att", value: "yes" },
        { field_id: "f_tr", value: "true" },
        { field_id: "f_c", value: "columbus" },
        { field_id: "f_c", value: "state" },
      ],
    });
  });

  test("rejects when a required field is missing", () => {
    expect(validateAnswers([attending], [])).toEqual({ ok: false });
  });

  test("rejects an option value not on the field", () => {
    expect(validateAnswers([attending], [{ fieldId: "f_att", values: ["maybe"] }])).toEqual({ ok: false });
  });

  test("rejects a non-boolean value for a boolean field", () => {
    expect(validateAnswers([transport], [{ fieldId: "f_tr", values: ["yes"] }])).toEqual({ ok: false });
  });

  test("rejects multiple values for a single_select", () => {
    expect(validateAnswers([attending], [{ fieldId: "f_att", values: ["yes", "no"] }])).toEqual({ ok: false });
  });

  test("rejects an answer referencing an unknown field", () => {
    expect(validateAnswers([attending], [
      { fieldId: "f_att", values: ["yes"] },
      { fieldId: "ghost", values: ["x"] },
    ])).toEqual({ ok: false });
  });
});

describe("parseFormInput", () => {
  test("valid", () => {
    expect(parseFormInput({ title: "Outreach", kind: "event_signup", status: "draft" }))
      .toEqual({ title: "Outreach", description: null, kind: "event_signup", status: "draft" });
  });
  test("rejects unknown kind/status", () => {
    expect(parseFormInput({ title: "x", kind: "quiz", status: "draft" })).toBeNull();
    expect(parseFormInput({ title: "x", kind: "event_signup", status: "live" })).toBeNull();
  });
  test("rejects missing title", () => {
    expect(parseFormInput({ kind: "event_signup", status: "draft" })).toBeNull();
  });
});

describe("parseFieldInput", () => {
  test("select field requires >=1 option", () => {
    expect(parseFieldInput({ label: "Q", type: "single_select", required: true, position: 0, options: [] })).toBeNull();
  });
  test("boolean field ignores options", () => {
    expect(parseFieldInput({ label: "Q", type: "boolean", required: false, position: 1 }))
      .toEqual({ label: "Q", helpText: null, type: "boolean", required: false, position: 1, semanticKey: null, options: [] });
  });
  test("rejects unknown type and unknown semantic key", () => {
    expect(parseFieldInput({ label: "Q", type: "date", required: false, position: 0 })).toBeNull();
    expect(parseFieldInput({ label: "Q", type: "short_text", required: false, position: 0, semanticKey: "bogus" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev npx vitest run src/lib/forms.test.ts`
Expected: FAIL (module not found / exports undefined).

- [ ] **Step 3: Implement the validators**

```ts
// src/lib/forms.ts
import type { FormField, FormFieldOption, FormFieldType, SemanticKey } from "./types";
import { optInt, optString, reqString } from "./validate";

export type FieldWithOptions = FormField & { options: FormFieldOption[] };
export type SubmittedAnswer = { fieldId: string; values: string[] };
export type AnswerRow = { field_id: string; value: string };

const FIELD_TYPES: readonly FormFieldType[] = [
  "single_select", "multi_select", "boolean", "short_text", "long_text", "scale",
];
const SEMANTIC_KEYS: readonly SemanticKey[] = ["attending", "can_transport", "notes"];
const CHOICE_TYPES: readonly FormFieldType[] = ["single_select", "multi_select", "scale"];
const TEXT_MAX = 2000;

/** PURE. Validates a submission against a form's fields; returns flat answer rows for the DB. */
export function validateAnswers(
  fields: FieldWithOptions[],
  submitted: SubmittedAnswer[],
): { ok: true; answers: AnswerRow[] } | { ok: false } {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const seen = new Map<string, string[]>();
  for (const s of submitted) {
    if (!byId.has(s.fieldId)) return { ok: false }; // unknown field
    seen.set(s.fieldId, (s.values ?? []).filter((v) => v.trim().length > 0));
  }

  const answers: AnswerRow[] = [];
  for (const field of fields) {
    const values = seen.get(field.id) ?? [];
    if (values.length === 0) {
      if (field.required) return { ok: false };
      continue;
    }
    if (CHOICE_TYPES.includes(field.type)) {
      const allowed = new Set(field.options.map((o) => o.value));
      if (field.type === "multi_select") {
        for (const v of values) if (!allowed.has(v)) return { ok: false };
      } else {
        if (values.length !== 1 || !allowed.has(values[0])) return { ok: false };
      }
    } else if (field.type === "boolean") {
      if (values.length !== 1 || (values[0] !== "true" && values[0] !== "false")) return { ok: false };
    } else {
      // short_text / long_text
      if (values.length !== 1 || values[0].length > TEXT_MAX) return { ok: false };
    }
    for (const v of values) answers.push({ field_id: field.id, value: v });
  }
  return { ok: true, answers };
}

/** PURE. Null = invalid. */
export function parseFormInput(
  body: unknown,
): { title: string; description: string | null; kind: string; status: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const title = reqString(b.title, 200);
  if (!title) return null;
  const description = optString(b.description, 2000);
  if (!description) return null;
  const kind = typeof b.kind === "string" ? b.kind : "event_signup";
  if (kind !== "event_signup") return null;
  const status = typeof b.status === "string" ? b.status : "draft";
  if (!["draft", "published", "closed"].includes(status)) return null;
  return { title, description: description.value, kind, status };
}

/** PURE. Null = invalid. */
export function parseFieldInput(body: unknown): {
  label: string; helpText: string | null; type: FormFieldType; required: boolean;
  position: number; semanticKey: string | null; options: { value: string; label: string; position: number }[];
} | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const label = reqString(b.label, 300);
  if (!label) return null;
  const type = b.type;
  if (typeof type !== "string" || !FIELD_TYPES.includes(type as FormFieldType)) return null;
  const helpText = optString(b.helpText, 1000);
  if (!helpText) return null;
  const required = b.required === true;
  const pos = optInt(b.position, 0, 1000);
  if (!pos || pos.value === null) return null;
  let semanticKey: string | null = null;
  if (b.semanticKey !== undefined && b.semanticKey !== null) {
    if (typeof b.semanticKey !== "string" || !SEMANTIC_KEYS.includes(b.semanticKey as SemanticKey)) return null;
    semanticKey = b.semanticKey;
  }
  const isChoice = CHOICE_TYPES.includes(type as FormFieldType);
  const options: { value: string; label: string; position: number }[] = [];
  if (isChoice) {
    if (!Array.isArray(b.options) || b.options.length === 0) return null;
    for (let i = 0; i < b.options.length; i++) {
      const o = b.options[i] as Record<string, unknown>;
      const value = reqString(o?.value, 200);
      const optLabel = reqString(o?.label, 300);
      if (!value || !optLabel) return null;
      options.push({ value, label: optLabel, position: i });
    }
  }
  return { label, helpText: helpText.value, type: type as FormFieldType, required, position: pos.value, semanticKey, options };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev npx vitest run src/lib/forms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forms.ts src/lib/forms.test.ts
git commit -m "feat(forms): pure validators — validateAnswers, parseForm/FieldInput"
git push
```

---

### Task 4: `forms.ts` — DB logic (form/field/option CRUD + read-with-fields)

**Files:**
- Modify: `src/lib/forms.ts`
- Test: `src/lib/forms.test.ts` (append)

**Interfaces:**
- Consumes: `parseFormInput`, `parseFieldInput` (Task 3); `getDb` (db.ts); `formFromRow`, `formFieldFromRow`, `formFieldOptionFromRow` (Task 2).
- Produces:
  - `createForm(input, creatorId, db?): Promise<{ ok: true; id: string } | { ok: false; status: number }>`
  - `listForms(db?): Promise<Form[]>`
  - `getFormWithFields(id, db?): Promise<{ form: Form; fields: FieldWithOptions[] } | null>`
  - `updateForm(id, input, db?): Promise<{ ok: boolean; status: number }>`
  - `deleteForm(id, db?): Promise<{ ok: boolean; status: number }>`
  - `addField(formId, input, db?): Promise<{ ok: true; id: string } | { ok: false; status: number }>`
  - `deleteField(fieldId, db?): Promise<{ ok: boolean; status: number }>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/forms.test.ts (append)
import { createForm, getFormWithFields } from "./forms";

describe("createForm", () => {
  function fakeDb(insertError?: { code: string }) {
    return {
      from(table: string) {
        if (table !== "form") throw new Error(`unexpected table ${table}`);
        return {
          insert: () => ({
            select: () => ({
              single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "form1" }, error: null }),
            }),
          }),
        };
      },
    } as never;
  }
  test("201 returns new id", async () => {
    expect(await createForm({ title: "Outreach", description: null, kind: "event_signup", status: "draft" }, "m1", fakeDb()))
      .toEqual({ ok: true, id: "form1" });
  });
  test("maps FK violation to 400", async () => {
    expect(await createForm({ title: "x", description: null, kind: "event_signup", status: "draft" }, "m1", fakeDb({ code: "23503" })))
      .toEqual({ ok: false, status: 400 });
  });
});

describe("getFormWithFields", () => {
  function fakeDb() {
    return {
      from(table: string) {
        if (table === "form") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: "form1", title: "Outreach", description: null, kind: "event_signup", status: "published", created_by: "m1", created_at: "2020-01-01T00:00:00Z" },
        }) }) }) };
        if (table === "form_field") return { select: () => ({ eq: () => ({ order: async () => ({
          data: [{ id: "f1", form_id: "form1", label: "Attending?", help_text: null, type: "single_select", required: true, position: 0, semantic_key: "attending" }],
        }) }) }) };
        if (table === "form_field_option") return { select: () => ({ in: () => ({ order: async () => ({
          data: [{ id: "o1", field_id: "f1", value: "yes", label: "Yes", position: 0 }],
        }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }
  test("assembles form + fields + options", async () => {
    const r = await getFormWithFields("form1", fakeDb());
    expect(r?.form.title).toBe("Outreach");
    expect(r?.fields[0].options[0].value).toBe("yes");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev npx vitest run src/lib/forms.test.ts`
Expected: FAIL (`createForm`, `getFormWithFields` undefined).

- [ ] **Step 3: Implement the DB functions**

Append to `src/lib/forms.ts` (import `SupabaseClient`, `Form`, row helpers, and `getDb` lazily like the events modules do):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Form, FormFieldOptionRow, FormFieldRow, FormRow } from "./types";
import { formFieldFromRow, formFieldOptionFromRow, formFromRow } from "./types";

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
function mapWriteError(code: string | undefined): number {
  if (code === FOREIGN_KEY_VIOLATION) return 400;
  if (code === UNIQUE_VIOLATION) return 409;
  return 500;
}

export async function createForm(
  input: { title: string; description: string | null; kind: string; status: string },
  creatorId: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("form")
    .insert({ title: input.title, description: input.description, kind: input.kind, status: input.status, created_by: creatorId })
    .select("id")
    .single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true, id: data.id as string };
}

export async function listForms(db?: SupabaseClient): Promise<Form[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("form").select("*").order("created_at", { ascending: false });
  return ((data ?? []) as FormRow[]).map(formFromRow);
}

export async function getFormWithFields(
  id: string,
  db?: SupabaseClient,
): Promise<{ form: Form; fields: FieldWithOptions[] } | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data: formRow } = await client.from("form").select("*").eq("id", id).maybeSingle();
  if (!formRow) return null;
  const { data: fieldRows } = await client.from("form_field").select("*").eq("form_id", id).order("position", { ascending: true });
  const fields = (fieldRows ?? []) as FormFieldRow[];
  const fieldIds = fields.map((f) => f.id);
  const { data: optionRows } = fieldIds.length
    ? await client.from("form_field_option").select("*").in("field_id", fieldIds).order("position", { ascending: true })
    : { data: [] as FormFieldOptionRow[] };
  const byField = new Map<string, FormFieldOptionRow[]>();
  for (const o of (optionRows ?? []) as FormFieldOptionRow[]) {
    (byField.get(o.field_id) ?? byField.set(o.field_id, []).get(o.field_id)!).push(o);
  }
  return {
    form: formFromRow(formRow as FormRow),
    fields: fields.map((f) => ({
      ...formFieldFromRow(f),
      options: (byField.get(f.id) ?? []).map(formFieldOptionFromRow),
    })),
  };
}

export async function updateForm(
  id: string,
  input: { title: string; description: string | null; status: string },
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("form")
    .update({ title: input.title, description: input.description, status: input.status })
    .eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteForm(id: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("form").delete().eq("id", id);
  // event.form_id FK is nullable with no cascade; a form attached to an event
  // will 23503 here — surface a clean 409.
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 409 : 500 };
  return { ok: true, status: 200 };
}

export async function addField(
  formId: string,
  input: NonNullable<ReturnType<typeof parseFieldInput>>,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("form_field")
    .insert({ form_id: formId, label: input.label, help_text: input.helpText, type: input.type, required: input.required, position: input.position, semantic_key: input.semanticKey })
    .select("id").single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  const fieldId = data.id as string;
  if (input.options.length) {
    const { error: optErr } = await client.from("form_field_option")
      .insert(input.options.map((o) => ({ field_id: fieldId, value: o.value, label: o.label, position: o.position })));
    if (optErr) return { ok: false, status: mapWriteError(optErr.code) };
  }
  return { ok: true, id: fieldId };
}

export async function deleteField(fieldId: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("form_field").delete().eq("id", fieldId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev npx vitest run src/lib/forms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forms.ts src/lib/forms.test.ts
git commit -m "feat(forms): form/field/option CRUD + getFormWithFields"
git push
```

---

### Task 5: `form-responses.ts` — submit + read

**Files:**
- Create: `src/lib/form-responses.ts`
- Test: `src/lib/form-responses.test.ts`

**Interfaces:**
- Consumes: `validateAnswers`, `getFormWithFields`, `type SubmittedAnswer` (Tasks 3–4); `displayName` (people.ts).
- Produces:
  - `submitEventSignupResponse(eventId, personId, formId, submitted: SubmittedAnswer[], db?): Promise<{ ok: boolean; status: number }>`
  - `type ResponseRosterEntry = { personId: string; name: string; answers: { fieldId: string; value: string }[] }`
  - `listEventResponses(eventId, db?): Promise<ResponseRosterEntry[]>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/form-responses.test.ts
import { describe, expect, test } from "vitest";
import { submitEventSignupResponse } from "./form-responses";

const FORM = {
  form: { id: "form1", title: "Outreach", description: null, kind: "event_signup", status: "published", createdBy: "m1", createdAt: "2020-01-01T00:00:00Z" },
  fields: [{
    id: "f_att", formId: "form1", label: "Attending?", helpText: null, type: "single_select" as const,
    required: true, position: 0, semanticKey: "attending" as const,
    options: [{ id: "o1", fieldId: "f_att", value: "yes", label: "Yes", position: 0 }],
  }],
};

function fakeDb(opts: { rpcError?: { code: string } } = {}) {
  return {
    // getFormWithFields is injected via the form arg in tests; here we stub rpc only.
    rpc: async () => (opts.rpcError ? { data: null, error: opts.rpcError } : { data: "resp1", error: null }),
  } as never;
}

describe("submitEventSignupResponse", () => {
  test("201 on a valid submission", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1",
      [{ fieldId: "f_att", values: ["yes"] }], fakeDb(), FORM);
    expect(r).toEqual({ ok: true, status: 201 });
  });
  test("400 when answers fail validation (missing required)", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1", [], fakeDb(), FORM);
    expect(r).toEqual({ ok: false, status: 400 });
  });
  test("409 when already signed up (unique violation from rpc)", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1",
      [{ fieldId: "f_att", values: ["yes"] }], fakeDb({ rpcError: { code: "23505" } }), FORM);
    expect(r).toEqual({ ok: false, status: 409 });
  });
  test("409 when the event is not open (P0100 from rpc)", async () => {
    const r = await submitEventSignupResponse("e1", "p1", "form1",
      [{ fieldId: "f_att", values: ["yes"] }], fakeDb({ rpcError: { code: "P0100" } }), FORM);
    expect(r).toEqual({ ok: false, status: 409 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./dev npx vitest run src/lib/form-responses.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Note the injectable `form` param on `submitEventSignupResponse` — it defaults to a real `getFormWithFields` call, but tests pass a stub to keep the validation logic under test without re-faking the whole read.

```ts
// src/lib/form-responses.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFormWithFields, validateAnswers, type FieldWithOptions, type SubmittedAnswer } from "./forms";
import { displayName } from "./people";
import type { Form } from "./types";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const EVENT_NOT_OPEN = "P0100";

export async function submitEventSignupResponse(
  eventId: string,
  personId: string,
  formId: string,
  submitted: SubmittedAnswer[],
  db?: SupabaseClient,
  form?: { form: Form; fields: FieldWithOptions[] } | null,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const loaded = form !== undefined ? form : await getFormWithFields(formId, client);
  if (!loaded) return { ok: false, status: 404 };
  const validated = validateAnswers(loaded.fields, submitted);
  if (!validated.ok) return { ok: false, status: 400 };
  const { error } = await client.rpc("submit_event_signup", {
    p_event_id: eventId,
    p_person_id: personId,
    p_form_id: formId,
    p_answers: validated.answers,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION || error.code === EVENT_NOT_OPEN) return { ok: false, status: 409 };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 400 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 201 };
}

export type ResponseRosterEntry = {
  personId: string;
  name: string;
  answers: { fieldId: string; value: string }[];
};

/** Every response for an event, joined to person + answers. Mentor-only surface. */
export async function listEventResponses(eventId: string, db?: SupabaseClient): Promise<ResponseRosterEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("form_response")
    .select("id, person_id, person(id, first_name, last_name, display_name), form_answer(field_id, value)")
    .eq("event_id", eventId);
  if (error) { console.error("listEventResponses failed", error); return []; }
  return ((data ?? []) as unknown as Array<{
    person_id: string;
    person: { first_name: string; last_name: string; display_name: string | null } | null;
    form_answer: { field_id: string; value: string | null }[];
  }>).map((r) => ({
    personId: r.person_id,
    name: r.person ? displayName(r.person) : r.person_id,
    answers: (r.form_answer ?? []).filter((a) => a.value !== null).map((a) => ({ fieldId: a.field_id, value: a.value as string })),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./dev npx vitest run src/lib/form-responses.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/form-responses.ts src/lib/form-responses.test.ts
git commit -m "feat(forms): submitEventSignupResponse (rpc) + listEventResponses"
git push
```

---

### Task 6: Extend `events.ts` with `formId`

**Files:**
- Modify: `src/lib/events.ts`
- Test: `src/lib/events.test.ts` (append)

**Interfaces:**
- Consumes: existing `EventInput`, `parseEventInput`, `createEvent`, `updateEvent`.
- Produces: `EventInput` gains `formId: string | null`; `parseEventInput` reads optional `formId` (must be a UUID or absent); `createEvent`/`updateEvent` write `form_id`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/events.test.ts (append; import parseEventInput if not already)
import { parseEventInput } from "./events";

test("parseEventInput accepts an optional formId", () => {
  const base = { name: "Demo", periodId: "11111111-1111-1111-1111-111111111111",
    location: "Gym", description: "d", startsAt: "2099-01-01T18:00:00Z", endsAt: "2099-01-01T20:00:00Z" };
  expect(parseEventInput({ ...base })?.formId).toBeNull();
  expect(parseEventInput({ ...base, formId: "22222222-2222-2222-2222-222222222222" })?.formId)
    .toBe("22222222-2222-2222-2222-222222222222");
  expect(parseEventInput({ ...base, formId: "not-a-uuid" })).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npx vitest run src/lib/events.test.ts`
Expected: FAIL (`formId` undefined on result / bad-uuid case returns an object).

- [ ] **Step 3: Implement**

In `src/lib/events.ts`:
- Add `formId: string | null;` to `EventInput`.
- In `parseEventInput`, after the existing validation and before the `return`, add:
  ```ts
  let formId: string | null = null;
  if (b.formId !== undefined && b.formId !== null) {
    formId = reqUuid(b.formId);
    if (!formId) return null;
  }
  ```
  and add `formId,` to the returned object.
- In `createEvent`'s `.insert({...})`, add `form_id: input.formId,`.
- In `updateEvent`'s `.update({...})`, add `form_id: input.formId,`.

- [ ] **Step 4: Run to verify it passes**

Run: `./dev npx vitest run src/lib/events.test.ts`
Expected: PASS (existing event tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/events.ts src/lib/events.test.ts
git commit -m "feat(forms): event.formId on EventInput/create/update"
git push
```

---

### Task 7: Admin form-builder API routes

**Files:**
- Create: `src/app/api/admin/forms/route.ts` (GET list, POST create)
- Create: `src/app/api/admin/forms/[id]/route.ts` (GET one-with-fields, PATCH, DELETE)
- Create: `src/app/api/admin/forms/[id]/fields/route.ts` (POST add field)
- Create: `src/app/api/admin/forms/fields/[fieldId]/route.ts` (DELETE field)

**Interfaces:**
- Consumes: `withRole` (api.ts); `parseFormInput`, `parseFieldInput`, `createForm`, `listForms`, `getFormWithFields`, `updateForm`, `deleteForm`, `addField`, `deleteField` (Tasks 3–4); `reqUuid` (validate.ts).
- Produces: the mentor-gated REST surface the builder UI (Task 11) calls.

- [ ] **Step 1: Implement the routes** (mirror `src/app/api/admin/events/route.ts` exactly for shape/auth)

```ts
// src/app/api/admin/forms/route.ts
import { withRole } from "@/lib/api";
import { createForm, listForms, parseFormInput } from "@/lib/forms";

export const GET = withRole("mentor", async () => {
  return Response.json({ forms: await listForms() });
});

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseFormInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createForm(input, viewer.person!.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
```

```ts
// src/app/api/admin/forms/[id]/route.ts
import { withRole } from "@/lib/api";
import { deleteForm, getFormWithFields, parseFormInput, updateForm } from "@/lib/forms";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRole<Ctx>("mentor", async (_v, _r, ctx) => {
  const id = reqUuid((await ctx.params).id);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const data = await getFormWithFields(id);
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(data);
});

export const PATCH = withRole<Ctx>("mentor", async (_v, request, ctx) => {
  const id = reqUuid((await ctx.params).id);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const parsed = parseFormInput(await request.json().catch(() => null));
  if (!parsed) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateForm(id, { title: parsed.title, description: parsed.description, status: parsed.status });
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole<Ctx>("mentor", async (_v, _r, ctx) => {
  const id = reqUuid((await ctx.params).id);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteForm(id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

```ts
// src/app/api/admin/forms/[id]/fields/route.ts
import { withRole } from "@/lib/api";
import { addField, parseFieldInput } from "@/lib/forms";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("mentor", async (_v, request, ctx) => {
  const formId = reqUuid((await ctx.params).id);
  if (!formId) return Response.json({ error: "invalid" }, { status: 400 });
  const input = parseFieldInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await addField(formId, input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
```

```ts
// src/app/api/admin/forms/fields/[fieldId]/route.ts
import { withRole } from "@/lib/api";
import { deleteField } from "@/lib/forms";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ fieldId: string }> };

export const DELETE = withRole<Ctx>("mentor", async (_v, _r, ctx) => {
  const fieldId = reqUuid((await ctx.params).fieldId);
  if (!fieldId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteField(fieldId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

- [ ] **Step 2: Typecheck + lint**

Run: `./dev npm run typecheck && ./dev npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/forms
git commit -m "feat(forms): admin form-builder API routes (mentor-gated)"
git push
```

---

### Task 8: Extend the sign-up route to accept answers

**Files:**
- Modify: `src/app/api/events/[id]/signup/route.ts`
- Test: covered by Task 5 unit tests + Task 12 e2e (route is thin glue).

**Interfaces:**
- Consumes: `getEvent` (events.ts), `submitEventSignupResponse` (Task 5), existing `signUpForEvent` / `cancelEventSignup`.
- Behavior: if the event has a `formId`, POST requires an `answers` body and routes through `submitEventSignupResponse`; if not, POST stays the existing plain boolean sign-up. DELETE is unchanged (cascade removes the response).

- [ ] **Step 1: Implement**

Replace the POST body in `src/app/api/events/[id]/signup/route.ts` (keep the rate-limiter, viewer, and `reqUuid` guards exactly as they are):

```ts
  // ...after `const id = reqUuid(rawId); if (!id) return 400` :
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ ok: false }, { status: 404 });

  if (event.formId) {
    const body = (await request.json().catch(() => null)) as { answers?: unknown } | null;
    const submitted = Array.isArray(body?.answers)
      ? (body!.answers as Array<{ fieldId?: unknown; values?: unknown }>).map((a) => ({
          fieldId: typeof a?.fieldId === "string" ? a.fieldId : "",
          values: Array.isArray(a?.values) ? (a.values as unknown[]).filter((v): v is string => typeof v === "string") : [],
        }))
      : [];
    const result = await submitEventSignupResponse(id, viewer.person.id, event.formId, submitted);
    return NextResponse.json({ ok: result.ok }, { status: result.status });
  }

  // No form attached: existing one-click boolean sign-up, unchanged.
  const result = await signUpForEvent(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
```

Add the imports: `import { getEvent } from "@/lib/events";` and `import { submitEventSignupResponse } from "@/lib/form-responses";`.

- [ ] **Step 2: Typecheck + full unit suite**

Run: `./dev npm run typecheck && ./dev npm run test`
Expected: clean; all green (including untouched `event-signups.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/events/[id]/signup/route.ts
git commit -m "feat(forms): route event sign-up through form response when a form is attached"
git push
```

---

### Task 9: Member-facing — render the attached form on sign-up

**Files:**
- Create: `src/components/EventSignupForm.tsx` (client component)
- Modify: the event sign-up surface that renders the sign-up button (find via `signedUpEventIds` usage — likely `src/app/events/page.tsx` and/or `src/components/EventRosterActions.tsx`).

**Interfaces:**
- Consumes: `getFormWithFields` (server-side, to pass fields as props) or the `GET /api/admin/forms/[id]` shape; `POST /api/events/[id]/signup` with `{ answers }`.
- Produces: a rendered form (one input per field by type) that submits answers; falls back to the existing one-click button when the event has no `formId`.

- [ ] **Step 1: Build the client component**

```tsx
// src/components/EventSignupForm.tsx
"use client";
import { useState } from "react";
import type { FieldWithOptions } from "@/lib/forms";

type Props = { eventId: string; fields: FieldWithOptions[]; onDone: () => void };

export function EventSignupForm({ eventId, fields, onDone }: Props) {
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(fieldId: string, vals: string[]) {
    setValues((v) => ({ ...v, [fieldId]: vals }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const answers = fields.map((f) => ({ fieldId: f.id, values: values[f.id] ?? [] }));
    const res = await fetch(`/api/events/${eventId}/signup`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    setBusy(false);
    if (res.ok) { onDone(); return; }
    setError(res.status === 409 ? "You've already responded to this event." : "Please check your answers and try again.");
  }

  return (
    <form className="card" onSubmit={submit}>
      {fields.map((f) => (
        <div key={f.id} style={{ marginBottom: "0.75rem" }}>
          <label><strong>{f.label}</strong>{f.required ? " *" : ""}</label>
          {f.helpText ? <div className="sub">{f.helpText}</div> : null}
          {(f.type === "single_select" || f.type === "scale") && (
            <select required={f.required} value={values[f.id]?.[0] ?? ""} onChange={(e) => set(f.id, [e.target.value])}>
              <option value="" disabled>Choose…</option>
              {f.options.map((o) => <option key={o.id} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {f.type === "multi_select" && f.options.map((o) => (
            <label key={o.id} style={{ display: "block" }}>
              <input type="checkbox" checked={(values[f.id] ?? []).includes(o.value)}
                onChange={(e) => {
                  const cur = new Set(values[f.id] ?? []);
                  e.target.checked ? cur.add(o.value) : cur.delete(o.value);
                  set(f.id, [...cur]);
                }} /> {o.label}
            </label>
          ))}
          {f.type === "boolean" && (
            <label><input type="checkbox" checked={values[f.id]?.[0] === "true"}
              onChange={(e) => set(f.id, [e.target.checked ? "true" : "false"])} /> Yes</label>
          )}
          {f.type === "short_text" && (
            <input type="text" required={f.required} value={values[f.id]?.[0] ?? ""} onChange={(e) => set(f.id, [e.target.value])} />
          )}
          {f.type === "long_text" && (
            <textarea required={f.required} value={values[f.id]?.[0] ?? ""} onChange={(e) => set(f.id, [e.target.value])} />
          )}
        </div>
      ))}
      {error ? <p className="sub" style={{ color: "var(--danger, crimson)" }}>{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Sign up"}</button>
    </form>
  );
}
```

- [ ] **Step 2: Wire it into the event sign-up surface**

On the events page (server component), for each upcoming event with a `formId`, load `getFormWithFields(event.formId)` and render `<EventSignupForm eventId=… fields=… onDone={router.refresh} />` instead of the plain sign-up button. Events with no `formId` keep the existing button. (Match the existing page's data-loading and layout; do not restructure it.)

- [ ] **Step 3: Manual check in the browser**

Run stack (already up in this worktree). Log in as Student (dev-login), open an event that has a form attached, submit, confirm success. Typecheck + lint.

Run: `./dev npm run typecheck && ./dev npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/components/EventSignupForm.tsx src/app/events
git commit -m "feat(forms): render attached sign-up form for members"
git push
```

---

### Task 10: Mentor roster — show responses

**Files:**
- Modify: `src/app/admin/events/[id]/page.tsx` (the mentor roster view) — add a responses section.

**Interfaces:**
- Consumes: `listEventResponses` (Task 5), `getFormWithFields` (Task 4, for field labels).
- Produces: a table on the event admin page showing each responder's answers (field label → value), grouped/sortable by the `attending` value.

- [ ] **Step 1: Implement**

In the event admin page's server load, when the event has a `formId`, fetch both `getFormWithFields(event.formId)` (for the ordered field labels + option label lookup) and `listEventResponses(event.id)`. Render a `.tablewrap`/`.table` with a column per field (using `field.label`), a row per responder (`entry.name` + each answer, mapping option `value`→`label` for choice fields, `true`/`false`→`Yes`/`No` for booleans). Sort rows by the `attending` answer (Coming, then Maybe, then Not-coming, then no-answer) using the `semanticKey === "attending"` field.

```tsx
// sketch inside the existing admin event page (server component)
const formData = event.formId ? await getFormWithFields(event.formId) : null;
const responses = event.formId ? await listEventResponses(event.id) : [];
// build fieldId -> field (with option value->label map) for rendering
// render a table: columns = formData.fields.map(f => f.label); one row per response
```

- [ ] **Step 2: Manual check**

As Mentor, open the event admin page after Task 9's submission; confirm the response appears with readable labels. Typecheck + lint.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/events
git commit -m "feat(forms): show sign-up responses on the mentor roster"
git push
```

---

### Task 11: Minimal form-builder UI (admin)

**Files:**
- Create: `src/app/admin/forms/page.tsx` (list + create form)
- Create: `src/app/admin/forms/[id]/page.tsx` (edit form: add/remove fields, set title/status)
- Create: `src/components/FormFieldEditor.tsx` (client: add a field with type/label/required/semantic key/options)
- Modify: the admin event form to add a "Sign-up form" `<select>` (the `formId` picker) — find it near where `parseEventInput`/`createEvent` are called from the UI (likely `src/app/admin/events/page.tsx` or an event form component).

**Interfaces:**
- Consumes: the Task 7 API routes; `listForms`, `getFormWithFields`.
- Produces: a mentor UI to create a form, add fields, and attach a form to an event via `event.formId`.

- [ ] **Step 1: Build the list/create page** (server component lists via `listForms`; a small client form POSTs to `/api/admin/forms`). Follow the `/admin/events` page structure and design-system classes.

- [ ] **Step 2: Build the edit page + `FormFieldEditor`** — server loads `getFormWithFields`; the client editor POSTs new fields to `/api/admin/forms/[id]/fields` and DELETEs via `/api/admin/forms/fields/[fieldId]`. For choice types, show a repeatable value/label option list; for `attending`/`can_transport`/`notes` offer the semantic-key dropdown. `router.refresh()` after each mutation.

- [ ] **Step 3: Add the `formId` picker to the admin event form** — a `<select>` populated from `listForms()` (option "None" = null), included in the event create/update payload as `formId`.

- [ ] **Step 4: Manual check** — create a form (attending single-select + transport boolean + notes long-text), attach it to an event, verify Tasks 9–10 render it end to end. Typecheck + lint.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/forms src/components/FormFieldEditor.tsx src/app/admin/events
git commit -m "feat(forms): minimal form-builder UI + event formId picker"
git push
```

---

### Task 12: End-to-end happy path + final verification

**Files:**
- Create: `e2e/event-signup-forms.spec.ts` (follow the existing Playwright specs' structure + dev-login helpers)

**Interfaces:**
- Consumes: the full stack built above.

- [ ] **Step 1: Write the e2e spec**

Flow: dev-login as Mentor → create a form (attending single-select Yes/Maybe/No + a notes long-text) → create an event and attach the form → dev-login as Student → open the event → submit the form (attending=Yes, a note) → dev-login as Mentor → open the event admin page → assert the student's name and answers appear in the responses table.

```ts
// e2e/event-signup-forms.spec.ts — mirror the setup/login helpers used by existing specs in e2e/
import { test, expect } from "@playwright/test";
// ... use the repo's existing dev-login + seeding helpers; assert on the roster response row.
```

- [ ] **Step 2: Run the full gate**

Run:
```
./dev npm run lint
./dev npm run typecheck
./dev npm run test
./dev npm run e2e
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add e2e/event-signup-forms.spec.ts
git commit -m "test(forms): e2e happy path — attach form, submit, roster shows answers"
git push
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --fill
```
Report the URL and re-flag: **the migration must be `supabase db push`'d to prod on merge.**

---

## Self-review notes

- **Spec coverage:** schema (Task 1) · types (Task 2) · pure validators incl. `validateAnswers` (Task 3) · form/field CRUD + `getFormWithFields` (Task 4) · atomic submit + `listEventResponses` (Task 5) · `event.formId` (Task 6) · mentor builder API (Task 7) · self-scoped submit wiring (Task 8) · member rendering (Task 9) · mentor roster responses (Task 10) · builder UI + formId picker (Task 11) · e2e + gate (Task 12). Approach A "existing code untouched" is guarded by keeping `event-signups.test.ts`/`events.test.ts` green (Tasks 6, 8).
- **Out of scope** (per spec / issue #181): other form kinds, extra field types, profile writeback, versioning, branching, public submissions, drag-and-drop builder polish, answer editing/re-submission.
- **Known v1 simplification:** re-submitting a sign-up returns 409 (one response per person per event); editing answers is deferred. `submit_event_signup` is atomic; a plain boolean sign-up path stays for form-less events.
