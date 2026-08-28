# Multi-Email Identities Implementation Plan (issue #32)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One person can sign in with multiple Google accounts (and hold multiple allowlisted emails) while remaining a single `person`, with admin-managed linking, exactly one primary email, and loud conflicts.

**Architecture:** New `person_identity` table (one row per email/Google-login per person) becomes the source of truth for sign-in identities. `person.email` is kept as the **primary-email control knob**: a DB trigger mirrors every write to `person.email` into the identity table (insert/rename/promote), so all five existing write paths (admin form, roster CSV import, application import, associate-email, OAuth bootstrap) keep working unchanged. Expand→contract rollout: the old `person.auth_user_id` column is dropped only in the final task, after all code reads identities.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (PostgREST via service-role `getDb()`), plpgsql trigger, vitest.

## Global Constraints

- Migrations as code: new committed migration files only; NEVER edit an applied migration. Apply locally via `docker exec team-hub-app-1 psql "postgresql://postgres:postgres@host.docker.internal:54322/postgres?sslmode=disable" -f <file>` is NOT available (file lives on host) — instead pipe: `docker exec -i team-hub-app-1 psql "postgresql://postgres:postgres@host.docker.internal:54322/postgres?sslmode=disable" < supabase/migrations/<file>.sql`, then record: `insert into supabase_migrations.schema_migrations (version, name) values ('<version>', '<name>');` via the same psql. Validate first with a BEGIN/ROLLBACK dry run.
- Tests run in the container: `docker exec team-hub-app-1 npx vitest run`
- Typecheck in the container: `docker exec team-hub-app-1 npx tsc --noEmit` — ignore pre-existing errors under `.next/dev/types/**`.
- Commit directly to `master`; `git push origin master` after EVERY commit.
- Emails are always stored lowercased. `person_identity.email` carries a DB check for it.
- Primary invariant: a person with ≥1 identity has EXACTLY one `is_primary` row (partial unique index + trigger). A person with no email has zero identities — that is allowed.
- Conflicts fail loudly (unique violations surface as 409/error redirects; never silently move an identity between people).
- Only admins manage identities (all new routes `withRole("admin", …)`).
- Provider column defaults to `'google'`; no other provider logic yet.
- Prod rollout ordering (operator step, documented in Task 8): apply the Task 1 migration to prod BEFORE the Task 2+ code deploys; apply the Task 8 contract migration only AFTER Task 2–7 code is live.

---

### Task 1: Expand migration — `person_identity` table, backfill, mirror trigger

**Files:**
- Create: `supabase/migrations/20260815230000_person_identities.sql`

**Interfaces:**
- Produces: table `person_identity (id, person_id, email, auth_user_id, is_primary, provider, created_at)`; trigger `person_sync_primary_identity` on `person`. `person.auth_user_id` REMAINS (dropped in Task 8).

- [ ] **Step 1: Write the migration**

```sql
-- Multi-email identities (issue #32). One person can hold many sign-in
-- emails / Google logins. person.email stays as the PRIMARY email control
-- knob: writes to it are mirrored into person_identity by trigger, so all
-- existing write paths (admin form, roster import, application import,
-- associate-email, OAuth bootstrap) keep working unchanged.
-- person.auth_user_id is retired in a LATER migration (expand → contract).

create table person_identity (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  email text not null unique check (email = lower(email)),
  -- The linked Google login, once that account has signed in. Nullable:
  -- an admin can pre-register an email before its owner ever logs in.
  auth_user_id uuid unique references auth.users (id) on delete set null,
  is_primary boolean not null default false,
  provider text not null default 'google',
  created_at timestamptz not null default now()
);

-- Exactly-one-primary: at most one primary row per person (the trigger
-- guarantees "at least one" whenever identities exist).
create unique index person_identity_one_primary
  on person_identity (person_id) where is_primary;

create index person_identity_person_id on person_identity (person_id);

-- RLS zero-policy like every table: default-deny; service role bypasses.
alter table person_identity enable row level security;

-- PostgREST (service role) needs explicit table grants on fresh DBs.
grant all on person_identity to service_role;

-- Backfill: one primary identity per person that has an email today.
-- A person linked to auth without a stored email (possible via an early
-- bootstrap) falls back to the auth.users email so their login survives.
insert into person_identity (person_id, email, auth_user_id, is_primary)
select p.id, coalesce(p.email, lower(u.email)), p.auth_user_id, true
from person p
left join auth.users u on u.id = p.auth_user_id
where p.email is not null
   or (p.auth_user_id is not null and u.email is not null);

-- Mirror trigger: person.email is the primary-email control knob.
--  * set to an email the person already holds  -> promote it to primary
--  * set to a brand-new email, primary exists  -> RENAME the primary
--    (keeps its auth link — an admin correcting a typo must not unlink)
--  * set to a brand-new email, no identities   -> insert first primary
--  * blanked, no secondaries                   -> delete the primary
--  * blanked, secondaries exist                -> refuse loudly
-- Unique violations (email owned by another person) propagate as 23505,
-- which existing handlers already map to 409.
create or replace function sync_primary_identity() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;

  if new.email is null then
    if exists (select 1 from person_identity
               where person_id = new.id and not is_primary) then
      raise exception
        'person has other linked emails; remove them or make one primary first'
        using errcode = 'P0001';
    end if;
    delete from person_identity where person_id = new.id and is_primary;
    return new;
  end if;

  if exists (select 1 from person_identity
             where person_id = new.id and email = new.email) then
    update person_identity set is_primary = false
      where person_id = new.id and is_primary and email <> new.email;
    update person_identity set is_primary = true
      where person_id = new.id and email = new.email;
    return new;
  end if;

  if exists (select 1 from person_identity
             where person_id = new.id and is_primary) then
    update person_identity set email = new.email
      where person_id = new.id and is_primary;
    return new;
  end if;

  insert into person_identity (person_id, email, is_primary)
  values (new.id, new.email, true);
  return new;
end $$;

create trigger person_sync_primary_identity
  after insert or update of email on person
  for each row execute function sync_primary_identity();
```

- [ ] **Step 2: Dry-run validate**

Run the whole file wrapped in `begin; … rollback;` through container psql. Then, still in a transaction, smoke the trigger:

```sql
begin;
-- (file contents already applied for real in step 3; here use a savepoint session)
insert into person (first_name, last_name, role, email) values ('T','One','student','t1@x.com');
select count(*) from person_identity where email = 't1@x.com' and is_primary; -- 1
update person set email = 't1b@x.com' where email = 't1@x.com';               -- rename
select email from person_identity where person_id = (select id from person where first_name='T' and last_name='One'); -- t1b@x.com
insert into person_identity (person_id, email)
  select id, 't1c@x.com' from person where first_name='T' and last_name='One'; -- secondary
update person set email = 't1c@x.com' where email = 't1b@x.com';               -- promote
select email from person_identity where is_primary and email in ('t1b@x.com','t1c@x.com'); -- t1c@x.com
update person set email = null where email = 't1c@x.com';                      -- must FAIL (secondaries exist)
rollback;
```

Expected: the final update raises `person has other linked emails…`; everything before behaves as commented.

- [ ] **Step 3: Apply + record**

Apply the migration for real via container psql; insert `('20260815230000', 'person_identities')` into `supabase_migrations.schema_migrations`. Verify: `select count(*) from person_identity;` matches the number of people with emails (seed has 2).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260815230000_person_identities.sql
git commit -m "feat(identities): person_identity table, backfill, primary-email mirror trigger"
git push origin master
```

---

### Task 2: Resolve viewers via `person_identity`

**Files:**
- Modify: `src/lib/viewer.ts` (only `getViewer`'s `findPersonByAuthUserId` implementation)
- Test: `src/lib/viewer.test.ts` (should not need changes — `resolveViewer` deps are injected; verify)

**Interfaces:**
- Consumes: `person_identity` from Task 1.
- Produces: nothing new — `resolveViewer` signature unchanged.

- [ ] **Step 1: Point the auth lookup at identities**

In `getViewer` (src/lib/viewer.ts), replace the `findPersonByAuthUserId` wiring. Today it calls `findOne("auth_user_id", id)` against `person`. New implementation:

```ts
findPersonByAuthUserId: async (id) => {
  const { data } = await db
    .from("person_identity")
    .select("person (*)")
    .eq("auth_user_id", id)
    .maybeSingle();
  const person = (data as { person: PersonRow | PersonRow[] | null } | null)?.person;
  return (Array.isArray(person) ? person[0] : person) ?? null;
},
```

(`findOne` stays for `findPersonById`.) The `is_active` gate stays in `resolveViewer` — unchanged.

- [ ] **Step 2: Run tests + typecheck**

`docker exec team-hub-app-1 npx vitest run src/lib/viewer.test.ts` → PASS (pure `resolveViewer` tests are dep-injected). Full `npx tsc --noEmit` clean (ignore `.next/dev/types/**`).

- [ ] **Step 3: Manual verify**

Log in locally with the linked Google account (or confirm an existing session still resolves): visiting `/` as the linked mentor shows their name, not guest.

- [ ] **Step 4: Commit**

```bash
git add src/lib/viewer.ts
git commit -m "feat(identities): resolve OAuth viewers via person_identity"
git push origin master
```

---

### Task 3: OAuth callback links identities

**Files:**
- Modify: `src/app/auth/callback/route.ts`
- Modify: `src/lib/oauth-link.ts` (doc comment only — decision shape unchanged)
- Test: `src/lib/oauth-link.test.ts` (verify still green; no shape change)

**Interfaces:**
- Consumes: `person_identity`; `decideOAuthLink` (unchanged signature).
- Produces: callback behavior — match ANY identity email; link = set `auth_user_id` on that identity row; idempotent on repeat logins; loud on conflicts.

- [ ] **Step 1: Rewrite the lookup block**

In `src/app/auth/callback/route.ts`, replace the four parallel queries:

```ts
const [
  { data: matchedIdentity, error: matchedError },
  { count, error: countError },
  { count: linkedCount, error: linkedCountError },
  { data: firstAdmin, error: firstAdminError },
] = await Promise.all([
  email
    ? db
        .from("person_identity")
        .select("id, auth_user_id, person (*)")
        .eq("email", email)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null }),
  db.from("person").select("id", { count: "exact", head: true }).eq("role", "admin"),
  // How many Google accounts are attached anywhere. Zero = fresh setup.
  db
    .from("person_identity")
    .select("id", { count: "exact", head: true })
    .not("auth_user_id", "is", null),
  db
    .from("person")
    .select("*")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle(),
]);
```

Derive `matched` for the decision:

```ts
type IdentityMatch = {
  id: string;
  auth_user_id: string | null;
  person: PersonRow | PersonRow[] | null;
};
const identity = (matchedIdentity as IdentityMatch | null) ?? null;
const matchedPerson = identity
  ? ((Array.isArray(identity.person) ? identity.person[0] : identity.person) ?? null)
  : null;
```

Keep all four fail-closed error checks exactly as they are today (same log messages, `toErrorRedirect()` semantics), and pass `matchedPerson` into `decideOAuthLink`.

- [ ] **Step 2: Rewrite the "link" action (idempotent + loud)**

```ts
} else if (decision.action === "link") {
  // Repeat login by an already-linked account is a no-op success.
  if (identity!.auth_user_id === data.user.id) return redirect;
  // Same email suddenly presenting a DIFFERENT auth user (e.g. the Supabase
  // auth user was deleted and re-created) must never silently steal the
  // identity — fail loudly. Q5 in issue #32.
  if (identity!.auth_user_id !== null) {
    console.error("oauth callback: identity email already linked to another auth user", {
      identityId: identity!.id,
      email,
      authUserId: data.user.id,
    });
    return toErrorRedirect();
  }
  const { data: linked, error: linkError } = await db
    .from("person_identity")
    .update({ auth_user_id: data.user.id })
    .eq("id", identity!.id)
    .is("auth_user_id", null)
    .select("id");
  if (linkError) {
    console.error("oauth callback: failed to link identity", {
      identityId: identity!.id,
      authUserId: data.user.id,
      error: linkError,
    });
    return toErrorRedirect();
  }
  if (!linked || linked.length === 0) {
    // Concurrent login won the race — fail loudly rather than guess.
    console.error("oauth callback: identity linked concurrently", {
      identityId: identity!.id,
      authUserId: data.user.id,
    });
    return toErrorRedirect();
  }
}
```

- [ ] **Step 3: Rewrite "bootstrap-admin"**

Matched branch: promote the person AND link the identity —

```ts
if (matchedPerson) {
  const { error: updateError } = await db
    .from("person")
    .update({ role: "admin", is_active: true })
    .eq("id", matchedPerson.id);
  // (error handling: same log + toErrorRedirect pattern as today)
  const { error: linkError } = await db
    .from("person_identity")
    .update({ auth_user_id: data.user.id })
    .eq("id", identity!.id)
    .is("auth_user_id", null);
  // (error handling: log + toErrorRedirect)
}
```

Unmatched branch: keep today's `person` insert exactly (it sets `email`, which the Task 1 trigger mirrors into a primary identity), REMOVE `auth_user_id` from the insert payload, then attach the login:

```ts
const { error: attachError } = await db
  .from("person_identity")
  .update({ auth_user_id: data.user.id })
  .eq("email", email!)
  .is("auth_user_id", null);
// (log + toErrorRedirect on error)
```

Keep the existing concurrent-double-bootstrap comment — the `person.email` unique constraint still catches it at the insert.

- [ ] **Step 4: Rewrite "adopt-admin"**

```ts
} else if (decision.action === "adopt-admin") {
  // Fresh setup: attach this login to the first admin's primary identity,
  // but only while it's unlinked — the .is() guard keeps two simultaneous
  // first logins safe (the loser matches nothing and stays a guest).
  const { data: adopted, error: adoptError } = await db
    .from("person_identity")
    .update({ auth_user_id: data.user.id })
    .eq("person_id", decision.personId!)
    .eq("is_primary", true)
    .is("auth_user_id", null)
    .select("id");
  if (adoptError) { /* log + toErrorRedirect, as today */ }
  if (adopted && adopted.length > 0) {
    const { error: activateError } = await db
      .from("person")
      .update({ is_active: true })
      .eq("id", decision.personId!);
    if (activateError) { /* log + toErrorRedirect */ }
  } else if (email) {
    // First admin has no (unlinked) primary identity — e.g. seeded with no
    // email. Insert one; the one-primary partial unique index and the email
    // unique constraint make a concurrent duplicate fail loudly.
    const { error: insertError } = await db.from("person_identity").insert({
      person_id: decision.personId!,
      email,
      auth_user_id: data.user.id,
      is_primary: true,
    });
    if (insertError) {
      console.warn("oauth callback: first admin already adopted by a concurrent login", {
        personId: decision.personId,
        authUserId: data.user.id,
        error: insertError,
      });
      // stays a guest — same outcome as today's lost race
    } else {
      const { error: activateError } = await db
        .from("person")
        .update({ is_active: true, email })
        .eq("id", decision.personId!);
      if (activateError) { /* log + toErrorRedirect */ }
      // note: setting person.email fires the mirror trigger, which finds the
      // identity we just inserted and simply promotes it (already primary) — safe.
    }
  } else {
    console.warn("oauth callback: adopt-admin skipped — login has no email", {
      personId: decision.personId,
      authUserId: data.user.id,
    });
  }
}
```

- [ ] **Step 5: Update `oauth-link.ts` doc comments**

`decideOAuthLink` logic is untouched; update the comment on `linkedCount` to say "linked identities" instead of "people with auth_user_id".

- [ ] **Step 6: Run tests + typecheck + manual login**

`docker exec team-hub-app-1 npx vitest run src/lib/oauth-link.test.ts` → PASS unchanged. Full tsc clean. Manually sign out and back in locally with Google — lands as mentor/admin, `person_identity.auth_user_id` populated, repeat login works (idempotency).

- [ ] **Step 7: Commit**

```bash
git add src/app/auth/callback/route.ts src/lib/oauth-link.ts
git commit -m "feat(identities): OAuth callback matches and links via person_identity"
git push origin master
```

---

### Task 4: Identity library + admin email routes

**Files:**
- Create: `src/lib/identities.ts`
- Create: `src/lib/identities.test.ts`
- Create: `src/app/api/admin/people/[id]/emails/route.ts` (POST = add)
- Create: `src/app/api/admin/people/[id]/emails/[identityId]/route.ts` (DELETE = remove)
- Create: `src/app/api/admin/people/[id]/emails/[identityId]/primary/route.ts` (POST = make primary)
- Modify: `src/components/ReconcileReport.tsx` (fetch URL only)
- Delete: `src/app/api/admin/people/[id]/associate-email/route.ts`
- Modify: `src/lib/people.ts` (retire `setPersonEmail`) and `src/lib/people-mutations.test.ts` (drop its describe block)

**Interfaces:**
- Produces:
  - `type PersonIdentityRow = { id: string; person_id: string; email: string; auth_user_id: string | null; is_primary: boolean; provider: string; created_at: string }`
  - `listPersonIdentities(personId: string, db?: SupabaseClient): Promise<PersonIdentityRow[]>` (primary first, then by created_at)
  - `addPersonEmail(personId: string, email: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }>` — first email becomes primary (via `person.email` + trigger); later emails insert secondaries. 400 blank/malformed, 404 no person, 409 email taken.
  - `removePersonIdentity(personId: string, identityId: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number; reason?: "primary_with_secondaries" }>` — deleting the primary while secondaries exist → 409 with reason; deleting a sole primary blanks `person.email` (trigger removes the row); removing an identity with a linked login unlinks that Google account (admin-only by design, Q4).
  - `makePrimaryIdentity(personId: string, identityId: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }>` — sets `person.email` to the identity's email; the mirror trigger flips `is_primary` flags.

- [ ] **Step 1: Write failing tests** (`src/lib/identities.test.ts`)

Use the same hand-rolled db-stub style as `people-mutations.test.ts`. Cover at least:

```ts
describe("addPersonEmail", () => {
  test("400 on blank or malformed email (no db call)", …);           // stub throws if queried
  test("first email goes through person.email (becomes primary)", …); // person fetch returns { email: null }; expect update on "person" with { email: normalized }
  test("later email inserts a secondary identity", …);                // person fetch returns { email: "a@b.com" }; expect insert on "person_identity" with { person_id, email, is_primary: false }
  test("lowercases and trims", …);
  test("409 when the email belongs to someone else", …);              // insert error code 23505
  test("404 when the person doesn't exist", …);
});
describe("removePersonIdentity", () => {
  test("404 when identity missing or belongs to another person", …);
  test("deletes a secondary directly", …);
  test("409 primary_with_secondaries when primary and others exist", …);
  test("sole primary blanks person.email instead of direct delete", …); // expect update on "person" { email: null }
});
describe("makePrimaryIdentity", () => {
  test("404 when identity missing", …);
  test("200 no-op when already primary", …);
  test("sets person.email to the identity email", …);
});
```

Run: `docker exec team-hub-app-1 npx vitest run src/lib/identities.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/identities.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type PersonIdentityRow = {
  id: string;
  person_id: string;
  email: string;
  auth_user_id: string | null;
  is_primary: boolean;
  provider: string;
  created_at: string;
};

const UNIQUE_VIOLATION = "23505";

async function client(db?: SupabaseClient): Promise<SupabaseClient> {
  return db ?? (await import("./db")).getDb();
}

export async function listPersonIdentities(
  personId: string,
  db?: SupabaseClient,
): Promise<PersonIdentityRow[]> {
  const c = await client(db);
  const { data } = await c
    .from("person_identity")
    .select("*")
    .eq("person_id", personId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  return (data ?? []) as PersonIdentityRow[];
}

/**
 * Add a sign-in email to a person. Their FIRST email is written through
 * person.email (the primary control knob — the DB trigger creates the
 * primary identity); any further email inserts a secondary identity row.
 * 400 blank/malformed, 404 unknown person, 409 email owned by someone else.
 */
export async function addPersonEmail(
  personId: string,
  email: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return { ok: false, status: 400 };
  const c = await client(db);

  const { data: person } = await c
    .from("person")
    .select("id, email")
    .eq("id", personId)
    .maybeSingle();
  if (!person) return { ok: false, status: 404 };

  if (!(person as { email: string | null }).email) {
    const { error } = await c
      .from("person")
      .update({ email: normalized })
      .eq("id", personId);
    if (error) {
      return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
    }
    return { ok: true, status: 200 };
  }

  const { error } = await c.from("person_identity").insert({
    person_id: personId,
    email: normalized,
    is_primary: false,
  });
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  return { ok: true, status: 200 };
}

/**
 * Remove a sign-in email. Removing an identity with a linked Google login
 * unlinks that account (admin-only by design). The primary can only be
 * removed when it's the person's sole identity — then it goes through
 * person.email = null so the mirror trigger stays authoritative.
 */
export async function removePersonIdentity(
  personId: string,
  identityId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number; reason?: "primary_with_secondaries" }> {
  const c = await client(db);
  const { data } = await c
    .from("person_identity")
    .select("*")
    .eq("id", identityId)
    .eq("person_id", personId)
    .maybeSingle();
  const identity = data as PersonIdentityRow | null;
  if (!identity) return { ok: false, status: 404 };

  if (identity.is_primary) {
    const { count } = await c
      .from("person_identity")
      .select("id", { count: "exact", head: true })
      .eq("person_id", personId)
      .eq("is_primary", false);
    if ((count ?? 0) > 0) {
      return { ok: false, status: 409, reason: "primary_with_secondaries" };
    }
    const { error } = await c
      .from("person")
      .update({ email: null })
      .eq("id", personId);
    if (error) return { ok: false, status: 500 };
    return { ok: true, status: 200 };
  }

  const { error } = await c
    .from("person_identity")
    .delete()
    .eq("id", identityId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/** Promote an identity to primary by pointing person.email at it. */
export async function makePrimaryIdentity(
  personId: string,
  identityId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const c = await client(db);
  const { data } = await c
    .from("person_identity")
    .select("*")
    .eq("id", identityId)
    .eq("person_id", personId)
    .maybeSingle();
  const identity = data as PersonIdentityRow | null;
  if (!identity) return { ok: false, status: 404 };
  if (identity.is_primary) return { ok: true, status: 200 };

  const { error } = await c
    .from("person")
    .update({ email: identity.email })
    .eq("id", personId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

- [ ] **Step 3: Run the tests** → PASS.

- [ ] **Step 4: Routes**

`src/app/api/admin/people/[id]/emails/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { addPersonEmail } from "@/lib/identities";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// Add a sign-in email to a person (their first becomes primary). Also used
// by the Drive-sync report to claim an unrecognized group email. Admin-only.
export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = reqString(body?.email, 254);
  if (!email) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await addPersonEmail(id, email);
  if (!result.ok) {
    return Response.json(
      { error: result.status === 409 ? "email_taken" : "failed" },
      { status: result.status },
    );
  }
  return Response.json({ ok: true });
});
```

`src/app/api/admin/people/[id]/emails/[identityId]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { removePersonIdentity } from "@/lib/identities";

type Ctx = { params: Promise<{ id: string; identityId: string }> };

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id, identityId } = await context.params;
  const result = await removePersonIdentity(id, identityId);
  if (!result.ok) {
    return Response.json(
      { error: result.reason ?? "failed" },
      { status: result.status },
    );
  }
  return Response.json({ ok: true });
});
```

`src/app/api/admin/people/[id]/emails/[identityId]/primary/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { makePrimaryIdentity } from "@/lib/identities";

type Ctx = { params: Promise<{ id: string; identityId: string }> };

export const POST = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id, identityId } = await context.params;
  const result = await makePrimaryIdentity(id, identityId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

- [ ] **Step 5: Repoint ReconcileReport + retire the old route**

In `src/components/ReconcileReport.tsx`, change the fetch in `associate()` to `/api/admin/people/${personId}/emails` (same body, same error contract — `email_taken` handling stays). Delete `src/app/api/admin/people/[id]/associate-email/route.ts`. Remove `setPersonEmail` from `src/lib/people.ts` and its describe block from `src/lib/people-mutations.test.ts` (the behavior now lives in `addPersonEmail` — and note the semantic change: associate now ADDS an email instead of overwriting).

- [ ] **Step 6: Full test run + typecheck** → all green, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib/identities.ts src/lib/identities.test.ts src/app/api/admin/people src/components/ReconcileReport.tsx src/lib/people.ts src/lib/people-mutations.test.ts
git commit -m "feat(identities): identity lib + admin email routes; associate-email now adds instead of overwrites"
git push origin master
```

---

### Task 5: “Sign-in emails” card on the admin person page

**Files:**
- Create: `src/components/PersonEmails.tsx`
- Modify: `src/app/admin/people/[id]/page.tsx`
- Modify: `src/app/globals.css` (only if a small style is genuinely missing — prefer existing `.card`, `.table`, `.btn`, `.pill`/badge, `.mono` classes)

**Interfaces:**
- Consumes: `listPersonIdentities` (Task 4), the three routes (Task 4).

- [ ] **Step 1: Server page passes identities**

In `src/app/admin/people/[id]/page.tsx`, fetch identities alongside the person:

```ts
import { listPersonIdentities } from "@/lib/identities";
…
const [result, identities] = await Promise.all([
  getPersonWithTeams(id),
  listPersonIdentities(id),
]);
```

Render below the existing form card:

```tsx
<section className="card flex flex-col gap-3">
  <h2 className="text-base font-semibold">Sign-in emails</h2>
  <p className="text-sm text-[var(--muted)]">
    Any of these Google accounts signs in as {name}. The primary email is
    what shows elsewhere on the site (it’s the Email field above).
  </p>
  <PersonEmails personId={p.id} identities={identities.map((i) => ({
    id: i.id,
    email: i.email,
    isPrimary: i.is_primary,
    linked: i.auth_user_id !== null,
  }))} />
</section>
```

- [ ] **Step 2: Client component**

`src/components/PersonEmails.tsx` — follow the interaction/style idiom of `ReconcileReport.tsx`/`DriveSyncPanel.tsx` (useRouter().refresh() after mutations, `.btn`, error line in `--red`):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IdentityView = { id: string; email: string; isPrimary: boolean; linked: boolean };

export function PersonEmails({
  personId,
  identities,
}: {
  personId: string;
  identities: IdentityView[];
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function call(input: RequestInfo, init?: RequestInit) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(input, init);
      if (res.ok) {
        setEmail("");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        body?.error === "email_taken"
          ? "That email already belongs to someone else."
          : body?.error === "primary_with_secondaries"
            ? "Make another email primary before removing this one."
            : "Couldn't save that. Please try again.",
      );
    } catch {
      setError("Couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {identities.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No sign-in emails yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {identities.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="mono">{i.email}</span>
              {i.isPrimary && <span className="pill">Primary</span>}
              {i.linked && <span className="pill">Google linked</span>}
              {!i.isPrimary && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    call(`/api/admin/people/${personId}/emails/${i.id}/primary`, {
                      method: "POST",
                    })
                  }
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  const warning = i.linked
                    ? `Remove ${i.email}? This unlinks its Google sign-in.`
                    : `Remove ${i.email}?`;
                  if (!window.confirm(warning)) return;
                  call(`/api/admin/people/${personId}/emails/${i.id}`, {
                    method: "DELETE",
                  });
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          call(`/api/admin/people/${personId}/emails`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="add.email@example.com"
          aria-label="Add sign-in email"
        />
        <button type="submit" className="btn" disabled={busy || !email.trim()}>
          Add email
        </button>
      </form>
    </div>
  );
}
```

If `.pill` doesn’t exist in globals.css, use whatever small badge class the codebase already has (check how role badges render on People); only add CSS if nothing fits.

- [ ] **Step 3: Manual verify (light + dark)**

On a local person: add a second email, make it primary (form’s Email field shows the new primary after refresh), remove the old one, try adding an email owned by another person → “already belongs to someone else”.

- [ ] **Step 4: Full tests + typecheck, then commit**

```bash
git add src/components/PersonEmails.tsx src/app/admin/people/[id]/page.tsx src/app/globals.css
git commit -m "feat(identities): admin sign-in emails card on the person page"
git push origin master
```

---

### Task 6: Drive sync expects ALL linked emails

**Files:**
- Modify: `src/lib/drive-group-sync.ts`
- Modify: `src/lib/drive-group-sync.test.ts` (expected-set fixtures)
- Modify: `src/app/admin/drive-sync/page.tsx` (`expectedCount` + `nameByEmail` from identities)
- Modify: `docs/setup/google-drive-groups.md` (one paragraph: every linked email of an active member gets group access)

**Interfaces:**
- Consumes: `person_identity` nested embed through `person`.

- [ ] **Step 1: Update the reconcile expected set**

In `reconcileDriveGroups`, replace the membership query + flatten:

```ts
const { data: memberships } = await db
  .from("team_membership")
  .select("person (is_active, person_identity (email))")
  .eq("team_id", team.id);
type IdentityJoin = { email: string };
type PersonJoin = {
  is_active: boolean;
  person_identity: IdentityJoin | IdentityJoin[] | null;
};
const expected = ((memberships ?? []) as unknown as { person: PersonJoin | PersonJoin[] | null }[])
  .map((m) => (Array.isArray(m.person) ? m.person[0] : m.person))
  .filter((p): p is PersonJoin => !!p && p.is_active)
  .flatMap((p) =>
    (Array.isArray(p.person_identity)
      ? p.person_identity
      : p.person_identity
        ? [p.person_identity]
        : []
    ).map((i) => i.email.toLowerCase()),
  );
```

(Emails are stored lowercased; the `.toLowerCase()` is belt-and-suspenders, matching today.)

- [ ] **Step 2: Update `syncMembershipChange`**

Replace the single-person email fetch with all identities:

```ts
const { data: person } = await db
  .from("person")
  .select("is_active, person_identity (email)")
  .eq("id", personId)
  .maybeSingle();
type IdentityJoin = { email: string };
const p = person as { is_active: boolean; person_identity: IdentityJoin | IdentityJoin[] | null } | null;
const emails = !p || !p.is_active
  ? []
  : (Array.isArray(p.person_identity) ? p.person_identity : p.person_identity ? [p.person_identity] : [])
      .map((i) => i.email);
if (emails.length === 0) return;

const dirDeps = { fetch: globalThis.fetch, credentials };
for (const email of emails) {
  if (action === "add") {
    await insertGroupMember(dirDeps, groupEmail, email);
  } else {
    await deleteGroupMember(dirDeps, groupEmail, email);
  }
}
```

(Same never-throws envelope as today.)

- [ ] **Step 3: Update the admin page lookups**

In `src/app/admin/drive-sync/page.tsx`:
- `expectedCount()` uses the same nested-identity embed and counts EMAILS (matching the reconcile expected set), not people.
- `nameByEmail` must cover secondaries or linked second emails would render as clickable “unassociated” buttons in the report. Fetch identities once:

```ts
const { data: identityRows } = await db
  .from("person_identity")
  .select("email, person (first_name, last_name)");
const nameByEmail: Record<string, string> = {};
for (const row of (identityRows ?? []) as unknown as {
  email: string;
  person: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
}[]) {
  const p = Array.isArray(row.person) ? row.person[0] : row.person;
  if (p) nameByEmail[row.email] = `${p.first_name} ${p.last_name}`;
}
```

(`listPeople` is still needed for the picker; drop the old email loop over it.)

- [ ] **Step 4: Update tests, run, commit**

Adjust `drive-group-sync.test.ts` fixtures to the new join shape; add one case: an active member with two identities contributes both emails to `expected`. Full suite + tsc. Update `docs/setup/google-drive-groups.md`.

```bash
git add src/lib/drive-group-sync.ts src/lib/drive-group-sync.test.ts src/app/admin/drive-sync/page.tsx docs/setup/google-drive-groups.md
git commit -m "feat(identities): drive-group sync grants access to every linked email"
git push origin master
```

---

### Task 7: Import matchers cover identity emails

**Files:**
- Modify: `src/lib/people.ts` (`findPersonForRosterRow`)
- Modify: `src/lib/people.test.ts` or wherever `findPersonForRosterRow` is covered (check `roster-import.test.ts`)
- Modify: `src/lib/application-import-run.ts` (`byEmail` map)
- Modify: `src/lib/application-import-run.test.ts` (fixture shape)

Without this, a roster CSV or application carrying someone’s SECONDARY email misses the match and creates a duplicate person.

- [ ] **Step 1: Roster matcher**

In `findPersonForRosterRow`, replace the `person.email` lookup:

```ts
if (row.email) {
  const { data } = await client
    .from("person_identity")
    .select("person_id")
    .eq("email", row.email)
    .maybeSingle();
  if (data) return data.person_id as string;
}
```

(Identity emails are a superset of `person.email` after Task 1’s backfill, so no behavior is lost.)

- [ ] **Step 2: Application import matcher**

In `runApplicationImport` (application-import-run.ts), after loading the roster, also load identities and feed `byEmail` from them instead of `p.email`:

```ts
const { data: identityRows, error: identityError } = await db
  .from("person_identity")
  .select("person_id, email");
if (identityError) return { error: `identity_load_failed: ${identityError.message}` };
for (const row of (identityRows ?? []) as { person_id: string; email: string }[]) {
  pushId(byEmail, row.email, row.person_id);
}
```

(Keep the existing `normalizeEmail(p.email)` loop OR replace it — identities are a superset; replacing avoids double-push. Prefer replacing, and dedupe `pushId` targets if the helper doesn’t already.)

Note in a code comment: the per-column patch that writes `person.email` now RENAMES the person’s primary email (or promotes a matching secondary) via the mirror trigger — intended.

- [ ] **Step 3: Tests**

Add a case per matcher: a row carrying a secondary email resolves to the existing person (no duplicate created). Full suite + tsc.

- [ ] **Step 4: Commit**

```bash
git add src/lib/people.ts src/lib/application-import-run.ts src/lib/*.test.ts
git commit -m "fix(identities): roster + application imports match any linked email"
git push origin master
```

---

### Task 8: Contract migration — drop `person.auth_user_id`

**Files:**
- Create: `supabase/migrations/20260815233000_drop_person_auth_user_id.sql`
- Modify: `src/lib/types.ts` (remove `auth_user_id` from `PersonRow`)
- Modify: any test fixtures naming `auth_user_id` (`src/lib/types.test.ts`, `src/lib/people.test.ts`, `src/lib/reports.test.ts`, `src/lib/attendance.test.ts`, `src/lib/viewer.test.ts`, `src/lib/oauth-link.test.ts` — grep to confirm the live list)
- Modify: `docs/setup/*` if any doc mentions `person.auth_user_id`

**Only start this task after Tasks 2–7 are committed AND deployed** (locally that’s immediate; for prod see the rollout note below).

- [ ] **Step 1: Migration**

```sql
-- Contract step of the person_identity rollout (issue #32): all code now
-- reads/writes identities; the single-login column is retired.
alter table person drop column auth_user_id;
```

Dry-run (BEGIN/ROLLBACK), apply, record `('20260815233000', 'drop_person_auth_user_id')`.

- [ ] **Step 2: Remove the field from `PersonRow`** and clean every fixture that grep finds. Full suite + tsc → green/clean.

- [ ] **Step 3: Verify locally** — OAuth login still works; People page loads.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(identities): drop person.auth_user_id (contract step)"
git push origin master
```

- [ ] **Step 5: Prod rollout note (operator steps — record in the final summary, do not perform unasked):**
  1. Apply `20260815230000_person_identities.sql` to prod (before or with the Task 2 deploy — Vercel deploys every push, so in practice: apply it as soon as Task 1 is pushed).
  2. After Tasks 2–7 are deployed, apply `20260815233000_drop_person_auth_user_id.sql`.
  3. Record both in prod `supabase_migrations.schema_migrations`.

---

## Behavior changes to call out (user-visible)

1. **Drive sync grants access to every linked email** of an active member (not just the primary). A mentor’s personal Gmail linked as a secondary gets group access too, and stops showing up in “would be removed”.
2. **Associate-email (Drive-sync report modal) now ADDS an email** to the chosen person instead of overwriting their only email.
3. **Blanking a person’s Email field** in the admin form now removes their sole sign-in email — and unlinks a Google login attached to it. (Today the login link survives an email edit.) Blanking while secondary emails exist is refused with an error.
4. **Renaming the Email field** re-points the primary identity (login link preserved) — or, if the new value matches one of the person’s other emails, just promotes that one to primary.
