# Merge Duplicate People Implementation Plan (issue #33)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin dashboard that surfaces likely-duplicate people (ranked by name similarity) and merges a chosen duplicate into a canonical person — reassigning all references atomically and recording a name alias so re-imports don't recreate the duplicate.

**Architecture:** A pure name-similarity library ranks candidate pairs. An atomic plpgsql `merge_person(winner, loser)` function reassigns every FK reference (handling composite-key/unique collisions), moves the loser's `person_identity` rows to the winner as secondaries, records the loser's name in a new `person_name_alias` table, and deletes the loser. The time-sheet and application importers consult the alias table before auto-creating a person.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (PostgREST service-role via `getDb()`, incl. `.rpc()`), plpgsql, vitest.

## Decisions (issue #33 open questions — resolved for this plan)

1. **Canonical choice:** the admin picks per-merge; the UI shows both records side-by-side with stats (role, emails, session count, teams) and lets them choose which is canonical (winner).
2. **Auth/email conflict:** NOT a blocker. Post-#32, sign-in emails live in `person_identity` with a global unique constraint, so the two people's emails are already distinct. The merge moves the loser's identities to the winner with `is_primary = false` (winner keeps its own primary). A linked Google login therefore transfers cleanly as a secondary identity — exactly the #32 multi-identity model.
3. **Fuzzy algorithm + threshold:** no `pg_trgm` is enabled; compute in application code. Normalized Levenshtein similarity on the combined `"first last"` (case/space-normalized), PLUS a heuristic boost for exact-last-name + first-name-prefix (catches "Nat"/"Nathan"). Surface pairs scoring ≥ 0.72 OR matching the prefix heuristic; rank by score desc.
4. **Undo/audit:** confirm-with-preview only (the UI shows exactly what will be reassigned before the admin confirms). No undo/audit table (YAGNI, and out of scope per the issue). The merge logs a one-line breadcrumb server-side.
5. **Import interaction:** a `person_name_alias` table (generated `name_key` unique column). The merge records the loser's name (and re-parents the loser's existing aliases) to the winner. The time-import auto-create path and the application-import exact-match stage consult aliases before creating, so a merged-away name resolves to the canonical person.

## Global Constraints

- Migrations as code: NEW committed migration files only; never edit an applied one. Local apply is Dockerized (the in-container CLI can't reach the DB): pipe the file into container psql —
  `docker exec -i team-hub-app-1 psql "postgresql://postgres:postgres@host.docker.internal:54322/postgres?sslmode=disable" < supabase/migrations/<file>.sql`
  then record: `insert into supabase_migrations.schema_migrations (version, name) values ('<version>', '<name>');` via the same psql. DRY-RUN first with BEGIN/ROLLBACK. Production migrations apply on Vercel deploy — do not touch prod.
- Tests: `docker exec team-hub-app-1 npx vitest run`. Typecheck: `docker exec team-hub-app-1 npx tsc --noEmit 2>&1 | grep -v ".next/dev/types"` (pre-existing `.next/dev/types` errors are ignored noise).
- Commit directly to `master`; `git push origin master` after EVERY commit. Co-author trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Emails are always lowercased (DB check). Names in `name_key` are normalized `lower(btrim(first)) || '|' || lower(btrim(last))` — the JS `nameKey` MUST produce the identical string.
- All new routes are `withRole("admin", …)`.
- The merge is atomic: it MUST be a single DB function call, never a sequence of PostgREST writes.

## Canonical FK reference map (verified against migrations)

Subject columns (a person is the subject — reassign, with collision handling):
- `session.person_id` (no per-person uniqueness → plain reassign)
- `team_membership.person_id` — PK `(person_id, team_id)`
- `membership_application.person_id` — partial unique `(person_id, team_id) where status='pending'`
- `excusal.person_id` — PK `(person_id, date)`
- `excusal_request.person_id` — partial unique `(person_id, date) where status='pending'`
- `person_identity.person_id` — `email` unique; partial unique `(person_id) where is_primary`
- `person_guardian.person_id` — PK `(person_id, guardian_id)`
- `first_experience.person_id` — unique `(person_id, level, year)`

Actor columns (RESTRICT — must reassign or the delete is blocked):
- `session.edited_by`, `excusal.created_by`, `membership_application.reviewed_by`,
  `account_request.reviewed_by`, `kiosk_device.created_by`, `excusal_request.reviewed_by`

(`meeting`, `build_day`, `team`, `period`, `app_setting`, `guardian` have no person FK. `account_request` has NO subject FK — only `reviewed_by`.)

---

### Task 1: Shared name-match library

**Files:**
- Create: `src/lib/name-match.ts`
- Create: `src/lib/name-match.test.ts`

**Interfaces:**
- Produces:
  - `normalizeFull(s: string): string` — `s.trim().toLowerCase().replace(/\s+/g, " ")`
  - `nameKey(first: string, last: string): string` — `` `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}` `` (MUST equal the SQL generated column `lower(btrim(first))||'|'||lower(btrim(last))`)
  - `isPrefixMatch(a: string, b: string): boolean` — true if either trimmed-lowercased string is a non-empty prefix of the other
  - `nameSimilarity(aFirst, aLast, bFirst, bLast): number` — 0..1 similarity of the two full names (see below)

- [ ] **Step 1: Write failing tests** (`src/lib/name-match.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import { nameKey, normalizeFull, isPrefixMatch, nameSimilarity } from "./name-match";

describe("nameKey", () => {
  test("normalizes case and surrounding space, pipe-separated", () => {
    expect(nameKey("  Ada ", "Lovelace")).toBe("ada|lovelace");
  });
});

describe("normalizeFull", () => {
  test("collapses internal whitespace and lowercases", () => {
    expect(normalizeFull("  Ada   B  Lovelace ")).toBe("ada b lovelace");
  });
});

describe("isPrefixMatch", () => {
  test("true when one name is a prefix of the other", () => {
    expect(isPrefixMatch("Nat", "Nathan")).toBe(true);
    expect(isPrefixMatch("Nathan", "nat")).toBe(true);
  });
  test("false for unrelated names and for empty", () => {
    expect(isPrefixMatch("Bob", "Alice")).toBe(false);
    expect(isPrefixMatch("", "Alice")).toBe(false);
  });
});

describe("nameSimilarity", () => {
  test("identical full names score 1", () => {
    expect(nameSimilarity("Ada", "Lovelace", "ada", " lovelace ")).toBe(1);
  });
  test("one-typo surname scores high (> 0.8)", () => {
    expect(nameSimilarity("Ada", "Lovelace", "Ada", "Lovlace")).toBeGreaterThan(0.8);
  });
  test("unrelated names score low (< 0.4)", () => {
    expect(nameSimilarity("Ada", "Lovelace", "Bob", "Zimmerman")).toBeLessThan(0.4);
  });
});
```

Run: `docker exec team-hub-app-1 npx vitest run src/lib/name-match.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement** (`src/lib/name-match.ts`)

```ts
/** Case/space-normalized full string. PURE. */
export function normalizeFull(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Canonical name key: `first|last`, lowercased and trimmed. MUST match the
 * `person_name_alias.name_key` generated column
 * (`lower(btrim(first))||'|'||lower(btrim(last))`) so JS lookups line up with
 * stored aliases. PURE.
 */
export function nameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;
}

/** True if one trimmed/lowercased string is a non-empty prefix of the other. PURE. */
export function isPrefixMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/** Levenshtein edit distance between two strings. PURE. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Similarity of two full names in [0, 1]: 1 - normalizedLevenshtein of the
 * normalized `"first last"` strings. PURE.
 */
export function nameSimilarity(
  aFirst: string,
  aLast: string,
  bFirst: string,
  bLast: string,
): number {
  const a = normalizeFull(`${aFirst} ${aLast}`);
  const b = normalizeFull(`${bFirst} ${bLast}`);
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
```

- [ ] **Step 3: Run tests** → PASS. Full suite + tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/name-match.ts src/lib/name-match.test.ts
git commit -m "feat(merge): shared name-similarity + canonical name-key library"
git push origin master
```

---

### Task 2: Migration — `person_name_alias` + atomic `merge_person` function

**Files:**
- Create: `supabase/migrations/20260816120000_merge_people.sql`

**Interfaces:**
- Produces: table `person_name_alias(id, person_id, name_key generated unique, first_name, last_name, created_at)`; function `merge_person(p_winner uuid, p_loser uuid) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- Merge-duplicate-people support (issue #33): a name-alias table so a
-- merged-away name resolves to the canonical person on re-import, plus an
-- atomic merge function that reassigns every reference from loser to winner
-- and deletes the loser in one transaction.

create table person_name_alias (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  -- Canonical lookup key; MUST match src/lib/name-match.ts nameKey().
  name_key text generated always as (lower(btrim(first_name)) || '|' || lower(btrim(last_name))) stored,
  created_at timestamptz not null default now(),
  unique (name_key)
);

create index person_name_alias_person_id on person_name_alias (person_id);

alter table person_name_alias enable row level security;
-- House pattern: default-deny, no policies; all access via service role.
grant all on person_name_alias to service_role;

-- Atomically merge p_loser into p_winner. Reassigns subject rows (deleting a
-- loser row first when it would collide with an existing winner row on a
-- unique/PK), reassigns RESTRICT actor columns, moves the loser's sign-in
-- identities to the winner as secondaries, records the loser's name (and
-- re-parents the loser's aliases) as winner aliases, then deletes the loser.
create or replace function merge_person(p_winner uuid, p_loser uuid)
returns void
language plpgsql
as $$
declare
  v_loser_first text;
  v_loser_last text;
  v_loser_email text;
begin
  if p_winner = p_loser then
    raise exception 'cannot merge a person into themselves' using errcode = 'P0001';
  end if;
  if not exists (select 1 from person where id = p_winner) then
    raise exception 'winner % not found', p_winner using errcode = 'P0002';
  end if;
  select first_name, last_name, email into v_loser_first, v_loser_last, v_loser_email
    from person where id = p_loser;
  if v_loser_first is null then
    raise exception 'loser % not found', p_loser using errcode = 'P0002';
  end if;

  -- session: partial unique `one_open_session_per_person` on (person_id) where
  -- time_out is null. If both have an OPEN session, drop the loser's open one
  -- (a spurious concurrent clock-in) before reassigning so the invariant holds.
  delete from session l
    where l.person_id = p_loser and l.time_out is null
      and exists (select 1 from session w
                  where w.person_id = p_winner and w.time_out is null);
  update session set person_id = p_winner where person_id = p_loser;
  update session set edited_by = p_winner where edited_by = p_loser;

  -- team_membership: PK (person_id, team_id). Carry the loser's manager flag
  -- onto the winner's row for shared teams before dropping the loser's dup.
  update team_membership w
    set is_manager = w.is_manager or l.is_manager
    from team_membership l
    where l.person_id = p_loser and w.person_id = p_winner and w.team_id = l.team_id;
  delete from team_membership l
    where l.person_id = p_loser
      and exists (select 1 from team_membership w
                  where w.person_id = p_winner and w.team_id = l.team_id);
  update team_membership set person_id = p_winner where person_id = p_loser;

  -- membership_application: partial unique (person_id, team_id) where pending.
  delete from membership_application l
    where l.person_id = p_loser and l.status = 'pending'
      and exists (select 1 from membership_application w
                  where w.person_id = p_winner and w.team_id = l.team_id
                    and w.status = 'pending');
  update membership_application set person_id = p_winner where person_id = p_loser;
  update membership_application set reviewed_by = p_winner where reviewed_by = p_loser;

  -- excusal: PK (person_id, date).
  delete from excusal l
    where l.person_id = p_loser
      and exists (select 1 from excusal w
                  where w.person_id = p_winner and w.date = l.date);
  update excusal set person_id = p_winner where person_id = p_loser;
  update excusal set created_by = p_winner where created_by = p_loser;

  -- excusal_request: partial unique (person_id, date) where pending.
  delete from excusal_request l
    where l.person_id = p_loser and l.status = 'pending'
      and exists (select 1 from excusal_request w
                  where w.person_id = p_winner and w.date = l.date
                    and w.status = 'pending');
  update excusal_request set person_id = p_winner where person_id = p_loser;
  update excusal_request set reviewed_by = p_winner where reviewed_by = p_loser;

  -- person_guardian: PK (person_id, guardian_id).
  delete from person_guardian l
    where l.person_id = p_loser
      and exists (select 1 from person_guardian w
                  where w.person_id = p_winner and w.guardian_id = l.guardian_id);
  update person_guardian set person_id = p_winner where person_id = p_loser;

  -- first_experience: unique (person_id, level, year).
  delete from first_experience l
    where l.person_id = p_loser
      and exists (select 1 from first_experience w
                  where w.person_id = p_winner and w.level = l.level and w.year = l.year);
  update first_experience set person_id = p_winner where person_id = p_loser;

  -- person_identity: emails are globally unique (no collision). Move to winner
  -- as secondaries; winner keeps its own primary.
  update person_identity
    set person_id = p_winner, is_primary = false
    where person_id = p_loser;

  -- Restore the #32 exactly-one-primary invariant: if the winner had NO email
  -- of its own (e.g. a name-only time-import auto-create picked as canonical),
  -- it now holds identities but no primary. Setting person.email fires the
  -- mirror trigger, which promotes the just-moved matching identity to primary.
  if v_loser_email is not null then
    update person set email = v_loser_email
      where id = p_winner and email is null;
  end if;

  -- account_request / kiosk_device actor columns (RESTRICT).
  update account_request set reviewed_by = p_winner where reviewed_by = p_loser;
  update kiosk_device set created_by = p_winner where created_by = p_loser;

  -- Re-parent the loser's existing aliases, then record the loser's own name.
  -- name_key is globally unique; on collision the alias already resolves
  -- somewhere, so skip.
  update person_name_alias set person_id = p_winner where person_id = p_loser;
  insert into person_name_alias (person_id, first_name, last_name)
    values (p_winner, v_loser_first, v_loser_last)
    on conflict (name_key) do nothing;

  delete from person where id = p_loser;
end $$;

grant execute on function merge_person(uuid, uuid) to service_role;
```

- [ ] **Step 2: Dry-run validate** (BEGIN/ROLLBACK through container psql)

Seed two people, give each an overlapping team membership + an identity, then merge and assert the loser is gone, references moved, and the loser's name is now a winner alias:

```sql
begin;
insert into person (id, first_name, last_name, role, email) values
  ('11111111-1111-1111-1111-111111111111','Nathan','Smith','student','nate.win@x.com'),
  ('22222222-2222-2222-2222-222222222222','Nat','Smith','student','nat.lose@x.com');
insert into team (id, name) values ('33333333-3333-3333-3333-333333333333','T') on conflict do nothing;
insert into team_membership (person_id, team_id) values
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333'),
  ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');
select merge_person('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
select count(*) from person where id = '22222222-2222-2222-2222-222222222222';          -- 0
select count(*) from team_membership where person_id = '11111111-1111-1111-1111-111111111111'; -- 1 (deduped)
select count(*) from person_identity where person_id = '11111111-1111-1111-1111-111111111111'; -- 2 (both, winner primary)
select count(*) from person_identity where person_id = '11111111-1111-1111-1111-111111111111' and is_primary; -- 1
select name_key from person_name_alias where person_id = '11111111-1111-1111-1111-111111111111'; -- nat|smith
rollback;
```

Expected: winner ends with one membership, both identities (one primary), and a `nat|smith` alias; loser row gone.

Also test the REVERSE email direction (winner email-less canonical, restores the primary invariant):

```sql
begin;
insert into person (id, first_name, last_name, role) values
  ('44444444-4444-4444-4444-444444444444','Jon','Doe','student');            -- winner, NO email
insert into person (id, first_name, last_name, role, email) values
  ('55555555-5555-5555-5555-555555555555','John','Doe','student','john@x.com'); -- loser, has email
select merge_person('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555');
select email from person where id = '44444444-4444-4444-4444-444444444444';                          -- john@x.com
select count(*) from person_identity where person_id = '44444444-4444-4444-4444-444444444444' and is_primary; -- 1
rollback;
```

Expected: the winner adopts the loser's email as its primary and ends with exactly one `is_primary` identity.

- [ ] **Step 3: Apply + record.** Apply the file via container psql; insert `('20260816120000','merge_people')` into `schema_migrations`. Verify the table + function exist (`\d person_name_alias`, `\df merge_person`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260816120000_merge_people.sql
git commit -m "feat(merge): person_name_alias table + atomic merge_person() function"
git push origin master
```

---

### Task 3: Importers consult the name-alias table

**Files:**
- Modify: `src/lib/time-import-run.ts`
- Modify: `src/lib/application-import-run.ts`
- Modify/verify tests: `src/lib/time-import-run.test.ts`, `src/lib/application-import-run.test.ts`

**Interfaces:**
- Consumes: `person_name_alias` (Task 2), `nameKey` (Task 1).

- [ ] **Step 1: time-import — import the shared `nameKey` and consult aliases before auto-create**

In `src/lib/time-import-run.ts`:
- Replace the local `nameKey` (the `\x00`-separated one) with `import { nameKey } from "./name-match";` (behavior-compatible; the separator only needs to be consistent within a run, and now matches the alias key). Leave `normalizeFull` as-is or import it too.
- Load aliases once alongside the roster: `const { data: aliasRows } = await db.from("person_name_alias").select("person_id, name_key");` and build `aliasByKey: Map<string, string>` (name_key → person_id). Handle a load error the same way the roster load does.
- In the matcher loop, when the exact `byName`/`byDisplay` union yields ZERO candidates, look up `aliasByKey.get(nameKey(firstName, lastName))` BEFORE the auto-create branch. On a hit, treat it as a match to that person_id (same as the `==1` path). Only auto-create when the alias lookup also misses.

Add a test: a person was merged away (an alias row exists for their old name → canonical person); a time-import row carrying that old name resolves to the canonical person and does NOT auto-create.

- [ ] **Step 2: application-import — consult aliases in the exact-match stage**

In `src/lib/application-import-run.ts`:
- Load aliases (same query) and, in `matchApplicant`, after the exact `byNameKey`/`byPreferredKey`/`byEmail` union yields zero exact candidates, check `aliasByKey.get(nameKey(app.firstName, app.lastName))`. A hit is an exact match (auto-match), taking precedence over the fuzzy stage. Import `nameKey` from `./name-match` (it already uses the same `|` separator, so existing behavior is unchanged).

Add a test mirroring Step 1 for the application importer.

- [ ] **Step 3: Run affected tests + full suite + tsc** → all green/clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/time-import-run.ts src/lib/application-import-run.ts src/lib/*.test.ts
git commit -m "feat(merge): importers resolve merged-away names via person_name_alias"
git push origin master
```

---

### Task 4: Duplicate-candidate finder

**Files:**
- Create: `src/lib/duplicate-people.ts`
- Create: `src/lib/duplicate-people.test.ts`

**Interfaces:**
- Consumes: `nameSimilarity`, `isPrefixMatch` (Task 1).
- Produces:
  - `type DupPerson = { id: string; first_name: string; last_name: string }`
  - `type DupCandidate = { a: string; b: string; score: number }` (a/b are person ids, a is the higher `id`-sorted for determinism)
  - `findDuplicateCandidates(people: DupPerson[], opts?: { threshold?: number }): DupCandidate[]` — pairwise; include a pair when `nameSimilarity ≥ threshold` (default 0.72) OR (exact same normalized last name AND `isPrefixMatch(firstA, firstB)`); score = max(similarity, heuristic-hit ? 0.85 : 0); sorted by score desc then by ids for stability. PURE.

- [ ] **Step 1: Write failing tests** — cover: a typo-surname pair is found; a "Nat"/"Nathan" same-last-name pair is found via the prefix heuristic even if raw similarity is below threshold; unrelated people produce no pair; identical input list with one obvious dup returns exactly that pair; output is deterministically ordered. Run → FAIL.

- [ ] **Step 2: Implement** `findDuplicateCandidates` per the interface (double loop `i<j`, compute score, push when it clears the bar, sort). Keep it pure — no DB.

- [ ] **Step 3: Tests PASS**, full suite + tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/duplicate-people.ts src/lib/duplicate-people.test.ts
git commit -m "feat(merge): duplicate-candidate finder (name-similarity ranking)"
git push origin master
```

---

### Task 5: Duplicates + merge API routes

**Files:**
- Create: `src/lib/merge-people.ts` (DB helpers: candidate enrichment + merge call)
- Create: `src/app/api/admin/people/duplicates/route.ts` (GET)
- Create: `src/app/api/admin/people/merge/route.ts` (POST)
- Create: `src/lib/merge-people.test.ts`

**Interfaces:**
- Produces:
  - `type CandidatePair = { score: number; a: PersonCard; b: PersonCard }` where `PersonCard = { id, firstName, lastName, role, isActive, emails: string[], sessionCount: number, teams: string[] }`
  - `listDuplicateCandidates(db?): Promise<CandidatePair[]>` — loads all people, runs `findDuplicateCandidates`, enriches each side with emails (`person_identity`), session count (`session`), team names (`team_membership → team`). Cap at the top 100 pairs.
  - `mergePeople(winnerId, loserId, db?): Promise<{ ok: boolean; status: number }>` — validates winner≠loser, calls `db.rpc("merge_person", { p_winner: winnerId, p_loser: loserId })`; maps a self-merge error → 400, not-found → 404, else 500 on rpc error, 200 on success.

- [ ] **Step 1: Implement `merge-people.ts`.** `listDuplicateCandidates` calls `findDuplicateCandidates` then enriches (batch the per-person stats; N is small). `mergePeople` wraps the RPC; inspect the PostgREST error `code`/`message` to map P0001→400 and P0002→404.

- [ ] **Step 2: Routes.**

`duplicates/route.ts`:
```ts
import { withRole } from "@/lib/api";
import { listDuplicateCandidates } from "@/lib/merge-people";

export const GET = withRole("admin", async () => {
  const pairs = await listDuplicateCandidates();
  return Response.json({ pairs });
});
```

`merge/route.ts`:
```ts
import { withRole } from "@/lib/api";
import { mergePeople } from "@/lib/merge-people";
import { reqString } from "@/lib/validate";

export const POST = withRole("admin", async (_viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const winnerId = reqString(body?.winnerId, 64);
  const loserId = reqString(body?.loserId, 64);
  if (!winnerId || !loserId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await mergePeople(winnerId, loserId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

- [ ] **Step 3: Tests** for `mergePeople` (self-merge→400 via stubbed rpc error code P0001; not-found→404 via P0002; rpc success→200; generic rpc error→500) using the hand-rolled db-stub idiom (stub a `.rpc()` returning `{ error }` / `{ error: null }`). Run affected + full suite + tsc.

- [ ] **Step 4: Commit**

```bash
git add src/lib/merge-people.ts src/lib/merge-people.test.ts src/app/api/admin/people/duplicates src/app/api/admin/people/merge
git commit -m "feat(merge): duplicates + merge admin API routes"
git push origin master
```

---

### Task 6: Admin “Find duplicates” page

**Files:**
- Create: `src/app/admin/people/duplicates/page.tsx` (server; admin-gated `redirect("/")`)
- Create: `src/components/DuplicatePeople.tsx` (client)
- Modify: `src/app/admin/people/page.tsx` (add a link to the duplicates page)

**Interfaces:**
- Consumes: `listDuplicateCandidates` (Task 5), `POST /api/admin/people/merge`.

- [ ] **Step 1: Server page** — admin-gate (match the convention in `src/app/admin/people/[id]/page.tsx`: `if (!hasRole(viewer.role, "admin")) redirect("/")`), call `listDuplicateCandidates()`, render `<DuplicatePeople pairs={pairs} />` in a `.card`. Header + a short explainer line.

- [ ] **Step 2: Client component** `DuplicatePeople.tsx` — for each pair, render the two `PersonCard`s side-by-side (name, role `.pill`, emails, session count, team list). Radio/toggle to choose which side is canonical (default: the one with more sessions, tie → the one with a linked email/identity, then lower id). A "Merge" button opens a confirm step that states plainly: "Merge <loser> into <canonical>. This reassigns <loser>'s sessions, teams, emails, and history to <canonical>, then deletes <loser>. This can't be undone." On confirm, POST to `/api/admin/people/merge`; on success `router.refresh()` (the merged pair drops off the list); on failure show a `--red` message. Disable controls while busy. Reuse the `.btn`/`.pill`/`.mono`/`.card` idiom from `PersonEmails.tsx`/`ReconcileReport.tsx`.

- [ ] **Step 3: Link** — add a "Find duplicates" link/button on `src/app/admin/people/page.tsx` near the existing controls, pointing to `/admin/people/duplicates`.

- [ ] **Step 4: tsc + full suite green.** Controller does the light/dark visual pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/people/duplicates src/components/DuplicatePeople.tsx src/app/admin/people/page.tsx
git commit -m "feat(merge): admin find-and-merge duplicates page"
git push origin master
```

---

### Task 7: Docs

**Files:**
- Create: `docs/features/merge-duplicate-people.md`
- Modify: any existing time-import doc to note the alias behavior (grep `docs/` for the time-import page; if none exists, skip).

- [ ] **Step 1: Write the feature doc** — what a duplicate is (name-only time-sheet import), how the finder ranks, what merge does (atomic reassign + alias so re-import won't recreate), and the caveats from this plan's "Behavior notes" section (irreversible; email-less-winner adopts the loser's email; open-session dedupe; manager-flag OR; no dismiss action; nightly reconcile self-heals Drive groups). Keep it short and operational.

- [ ] **Step 2: Commit**

```bash
git add docs/features/merge-duplicate-people.md
git commit -m "docs(merge): find-and-merge duplicate people feature doc"
git push origin master
```

---

## Behavior notes to surface after implementation

- Merge is irreversible (no undo table). The UI confirm step is the safety gate.
- After a merge, the loser's sign-in emails become **secondary** identities on the winner; the winner's primary email is unchanged.
- A re-import (time-sheet or application) of the merged-away name now resolves to the canonical person via `person_name_alias` instead of creating a new duplicate.
- Candidate ranking is a heuristic; the admin always confirms the specific pair and canonical choice.
- If the winner had no email of its own, it adopts the loser's email as its primary; otherwise the winner's primary is unchanged and the loser's emails become secondaries.
- Merging two people who both have an OPEN (unclosed) session drops the loser's open clock-in; the winner's open session is kept.
- When both are on the same team, the winner's membership keeps `is_manager = true` if EITHER had it.
- There is no "not a duplicate / dismiss" action: a pair the admin judges not-a-duplicate reappears on every visit to the page (acceptable at this roster size).
- Merge does not fire the real-time Drive-group hooks; the nightly reconcile self-heals group membership (consistent with the existing never-auto-remove design).
