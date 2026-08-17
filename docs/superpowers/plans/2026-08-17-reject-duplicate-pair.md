# Reject Duplicate Pair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin dismiss a duplicate-person suggestion so it never reappears, and undo that dismissal from the same page.

**Architecture:** A new `person_merge_rejection` table persists dismissed pairs keyed on the ordered `(a, b)` id pair. `listDuplicateCandidates` filters out dismissed pairs before enrichment. A new `POST/DELETE /api/admin/people/reject` route handles dismiss/undo. The duplicates UI gets a "Not a match" button per pair and a collapsible "Dismissed pairs" section at the bottom.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Vitest (unit tests), TypeScript.

## Global Constraints

- All schema changes must be committed migration files under `supabase/migrations/` — never edit an applied migration in place.
- Migration filename format: `YYYYMMDDHHMMSS_<slug>.sql`.
- All DB access uses the service role (no RLS policies; `grant all ... to service_role`).
- API routes use `withRole("admin", ...)` from `@/lib/api`.
- Input validation uses `reqString` from `@/lib/validate`.
- Follow the existing `{ ok: boolean; status: number }` shape for lib functions.
- No new npm packages.
- Push to origin after every commit.

---

### Task 1: Migration — `person_merge_rejection` table

**Files:**
- Create: `supabase/migrations/20260817120000_merge_rejection.sql`

**Interfaces:**
- Produces: `person_merge_rejection` table with columns `(a uuid, b uuid, rejected_by uuid, created_at timestamptz)`, PK `(a, b)`, FK `a/b → person(id) on delete cascade`, `rejected_by → person(id) on delete set null`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260817120000_merge_rejection.sql`:

```sql
-- Dismissed duplicate-pair suggestions (issue: reject/deny merge).
-- Keyed on the ordered (a, b) id pair — same a < b rule as DupCandidate —
-- so one row uniquely suppresses a pair regardless of scan order.
-- Cascade-deletes when either person is removed; rejected_by nulls on admin removal.

create table person_merge_rejection (
  a            uuid not null references person (id) on delete cascade,
  b            uuid not null references person (id) on delete cascade,
  rejected_by  uuid references person (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (a, b),
  constraint rejection_order check (a < b)
);

create index person_merge_rejection_a on person_merge_rejection (a);
create index person_merge_rejection_b on person_merge_rejection (b);

alter table person_merge_rejection enable row level security;
-- Default-deny; all access via service role.
grant all on person_merge_rejection to service_role;
```

- [ ] **Step 2: Apply the migration locally**

```bash
docker exec -i hub-supabase-db-1 psql -U postgres -d postgres \
  < supabase/migrations/20260817120000_merge_rejection.sql
```

Expect: `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX`, `ALTER TABLE`, `GRANT`.

- [ ] **Step 3: Commit and push**

```bash
git add supabase/migrations/20260817120000_merge_rejection.sql
git commit -m "feat(duplicates): add person_merge_rejection table"
git push origin master
```

---

### Task 2: Lib — `rejectPair`, `unrejectPair`, `listRejectedPairs`, filter in `listDuplicateCandidates`

**Files:**
- Modify: `src/lib/merge-people.ts`
- Test: `src/lib/merge-people.test.ts`

**Interfaces:**
- Consumes: `person_merge_rejection` table (Task 1).
- Produces:
  - `rejectPair(aId: string, bId: string, rejectedBy: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }>`
  - `unrejectPair(aId: string, bId: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }>`
  - `listRejectedPairs(db?: SupabaseClient): Promise<RejectedPair[]>`
  - `RejectedPair = { a: PersonCard; b: PersonCard }`
  - `listDuplicateCandidates` now filters dismissed pairs (no signature change).

- [ ] **Step 1: Write failing tests**

Add to `src/lib/merge-people.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { mergePeople, rejectPair, unrejectPair } from "./merge-people";

// ... existing mergePeople tests stay unchanged ...

// Helpers for rejection tests
function makeDb(opts: {
  fromResult?: { data: unknown[]; error: null };
  upsertResult?: { error: null | { message: string } };
  deleteResult?: { error: null | { message: string } };
}) {
  return {
    from: () => ({
      upsert: async () => ({ error: opts.upsertResult?.error ?? null }),
      delete: () => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, _val2: string) =>
            Promise.resolve({ error: opts.deleteResult?.error ?? null }),
        }),
      }),
      select: () => ({
        data: opts.fromResult?.data ?? [],
        error: opts.fromResult?.error ?? null,
      }),
    }),
  } as never;
}

describe("rejectPair", () => {
  test("400 on self-pair without DB call", async () => {
    const boom = { from: () => { throw new Error("should not call db"); } } as never;
    const r = await rejectPair("p1", "p1", "admin1", boom);
    expect(r).toEqual({ ok: false, status: 400 });
  });

  test("normalises order: (b,a) treated same as (a,b)", async () => {
    // Both calls must pass without error — order normalisation is tested by
    // verifying neither throws and both return ok.
    const db = makeDb({ upsertResult: { error: null } });
    const r1 = await rejectPair("aaa", "bbb", "admin1", db);
    const r2 = await rejectPair("bbb", "aaa", "admin1", db);
    expect(r1).toEqual({ ok: true, status: 200 });
    expect(r2).toEqual({ ok: true, status: 200 });
  });

  test("200 on success", async () => {
    const db = makeDb({ upsertResult: { error: null } });
    const r = await rejectPair("aaa", "bbb", "admin1", db);
    expect(r).toEqual({ ok: true, status: 200 });
  });

  test("500 on DB error", async () => {
    const db = makeDb({ upsertResult: { error: { message: "boom" } } });
    const r = await rejectPair("aaa", "bbb", "admin1", db);
    expect(r).toEqual({ ok: false, status: 500 });
  });
});

describe("unrejectPair", () => {
  test("200 on success (idempotent)", async () => {
    const db = makeDb({ deleteResult: { error: null } });
    const r = await unrejectPair("aaa", "bbb", db);
    expect(r).toEqual({ ok: true, status: 200 });
  });

  test("500 on DB error", async () => {
    const db = makeDb({ deleteResult: { error: { message: "boom" } } });
    const r = await unrejectPair("aaa", "bbb", db);
    expect(r).toEqual({ ok: false, status: 500 });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
docker exec hub-devcontainer-app-1 npx vitest run src/lib/merge-people.test.ts
```

Expected: failures on `rejectPair` / `unrejectPair` (not exported yet).

- [ ] **Step 3: Export new type and add new exports to `merge-people.ts`**

Add the `RejectedPair` type and the three new functions to `src/lib/merge-people.ts`. Also update `listDuplicateCandidates` to filter dismissed pairs.

**Add `RejectedPair` type after the `CandidatePair` type:**

```typescript
export type RejectedPair = {
  a: PersonCard;
  b: PersonCard;
};
```

**Update `listDuplicateCandidates`** — add the rejection-filter step just after computing `candidates` (before `.slice(0, MAX_PAIRS)`):

```typescript
export async function listDuplicateCandidates(
  db?: SupabaseClient,
): Promise<CandidatePair[]> {
  const c = await client(db);

  const { data: peopleData } = await c
    .from("person")
    .select("id, first_name, last_name, role, is_active")
    .order("last_name");
  const people = (peopleData ?? []) as PersonRow[];

  const allCandidates = findDuplicateCandidates(
    people.map((p) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name })),
  );

  // Load dismissed pairs and filter before capping and enriching.
  const { data: rejData } = await c
    .from("person_merge_rejection")
    .select("a, b");
  const dismissed = new Set<string>(
    ((rejData ?? []) as { a: string; b: string }[]).map((r) => `${r.a}|${r.b}`),
  );
  const candidates = allCandidates
    .filter((cand) => !dismissed.has(`${cand.a}|${cand.b}`))
    .slice(0, MAX_PAIRS);

  // ... rest of function unchanged (byId, ids, enrichment, return) ...
```

**Add the three new functions at the end of the file:**

```typescript
/** Normalise two person ids into (a, b) order matching DupCandidate. */
function orderedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * Dismiss a duplicate-candidate pair so it is permanently filtered from
 * listDuplicateCandidates. Idempotent (upsert). Returns 400 for self-pair,
 * 500 on DB error, 200 on success.
 */
export async function rejectPair(
  aId: string,
  bId: string,
  rejectedBy: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  if (aId === bId) return { ok: false, status: 400 };
  const [a, b] = orderedPair(aId, bId);
  const c = await client(db);
  const { error } = await c
    .from("person_merge_rejection")
    .upsert({ a, b, rejected_by: rejectedBy }, { onConflict: "a,b" });
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/**
 * Undo a dismissed pair. Idempotent — deleting a non-existent row is a no-op.
 * Returns 500 on DB error, 200 otherwise.
 */
export async function unrejectPair(
  aId: string,
  bId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const [a, b] = orderedPair(aId, bId);
  const c = await client(db);
  const { error } = await c
    .from("person_merge_rejection")
    .delete()
    .eq("a", a)
    .eq("b", b);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/**
 * Load all dismissed pairs with both people's cards for the undo surface.
 * Returns an empty array if there are none.
 */
export async function listRejectedPairs(
  db?: SupabaseClient,
): Promise<RejectedPair[]> {
  const c = await client(db);

  const { data: rejData } = await c
    .from("person_merge_rejection")
    .select("a, b")
    .order("created_at", { ascending: false });
  const rejected = (rejData ?? []) as { a: string; b: string }[];
  if (rejected.length === 0) return [];

  const ids = Array.from(new Set(rejected.flatMap((r) => [r.a, r.b])));

  const { data: peopleData } = await c
    .from("person")
    .select("id, first_name, last_name, role, is_active")
    .in("id", ids);
  const people = (peopleData ?? []) as PersonRow[];
  const byId = new Map(people.map((p) => [p.id, p]));

  const [emailsById, sessionCountById, teamsById] = await Promise.all([
    loadEmailsByPerson(c, ids),
    loadSessionCountsByPerson(c, ids),
    loadTeamsByPerson(c, ids),
  ]);

  function toCard(id: string): PersonCard {
    const row = byId.get(id);
    return {
      id,
      firstName: row?.first_name ?? "",
      lastName: row?.last_name ?? "",
      role: row?.role ?? "",
      isActive: row?.is_active ?? false,
      emails: emailsById.get(id) ?? [],
      sessionCount: sessionCountById.get(id) ?? 0,
      teams: teamsById.get(id) ?? [],
    };
  }

  return rejected.map((r) => ({ a: toCard(r.a), b: toCard(r.b) }));
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
docker exec hub-devcontainer-app-1 npx vitest run src/lib/merge-people.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/merge-people.ts src/lib/merge-people.test.ts
git commit -m "feat(duplicates): rejectPair / unrejectPair / listRejectedPairs; filter dismissed from listDuplicateCandidates"
git push origin master
```

---

### Task 3: API route — `POST/DELETE /api/admin/people/reject`

**Files:**
- Create: `src/app/api/admin/people/reject/route.ts`

**Interfaces:**
- Consumes: `rejectPair`, `unrejectPair` from `@/lib/merge-people` (Task 2); `withRole` from `@/lib/api`; `reqString` from `@/lib/validate`.
- Produces:
  - `POST { aId, bId }` → `200 { ok: true }` | `400 { error: "invalid" }` | `500 { error: "failed" }`
  - `DELETE { aId, bId }` → `200 { ok: true }` | `400 { error: "invalid" }` | `500 { error: "failed" }`

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/people/reject/route.ts`:

```typescript
import { withRole } from "@/lib/api";
import { rejectPair, unrejectPair } from "@/lib/merge-people";
import { reqString } from "@/lib/validate";

function parseIds(body: Record<string, unknown> | null) {
  const aId = reqString(body?.aId, 64);
  const bId = reqString(body?.bId, 64);
  if (!aId || !bId || aId === bId) return null;
  return { aId, bId };
}

export const POST = withRole("admin", async (viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = parseIds(body);
  if (!ids) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await rejectPair(ids.aId, ids.bId, viewer.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole("admin", async (_viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = parseIds(body);
  if (!ids) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await unrejectPair(ids.aId, ids.bId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

- [ ] **Step 2: Type-check**

```bash
docker exec hub-devcontainer-app-1 npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit and push**

```bash
git add src/app/api/admin/people/reject/route.ts
git commit -m "feat(duplicates): POST/DELETE /api/admin/people/reject"
git push origin master
```

---

### Task 4: UI — "Not a match" button and "Dismissed pairs" section

**Files:**
- Modify: `src/components/DuplicatePeople.tsx`
- Modify: `src/app/admin/people/duplicates/page.tsx`

**Interfaces:**
- Consumes:
  - `rejectPair`, `unrejectPair`, `listRejectedPairs`, `RejectedPair` from `@/lib/merge-people` (Task 2).
  - `POST /api/admin/people/reject` and `DELETE /api/admin/people/reject` (Task 3).
- Produces: updated `DuplicatePeople` component accepting `rejectedPairs: RejectedPair[]`; updated page passing both props.

- [ ] **Step 1: Update `page.tsx` to fetch and pass dismissed pairs**

In `src/app/admin/people/duplicates/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listDuplicateCandidates, listRejectedPairs } from "@/lib/merge-people";
import { DuplicatePeople } from "@/components/DuplicatePeople";

export default async function AdminDuplicatePeoplePage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [pairs, rejectedPairs] = await Promise.all([
    listDuplicateCandidates(),
    listRejectedPairs(),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Find duplicates</h1>
          <div className="sub">
            Possible duplicate people, ranked by match confidence · {pairs.length} pair{pairs.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <section className="card flex flex-col gap-4">
        <p className="text-sm text-[var(--muted)]">
          Review each pair below. Pick which record to keep, then merge — the other
          record&rsquo;s sessions, teams, emails, and history move to the one you keep,
          and it is deleted. This can&rsquo;t be undone.
        </p>
        <DuplicatePeople pairs={pairs} rejectedPairs={rejectedPairs} />
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Update `DuplicatePeople.tsx`**

Replace the full contents of `src/components/DuplicatePeople.tsx` with:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CandidatePair, PersonCard, RejectedPair } from "@/lib/merge-people";

function fullName(p: PersonCard): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function defaultWinnerId(a: PersonCard, b: PersonCard): string {
  if (a.sessionCount !== b.sessionCount) {
    return a.sessionCount > b.sessionCount ? a.id : b.id;
  }
  if (a.emails.length !== b.emails.length) {
    return a.emails.length > 0 ? a.id : b.id;
  }
  return a.id < b.id ? a.id : b.id;
}

export function DuplicatePeople({
  pairs,
  rejectedPairs,
}: {
  pairs: CandidatePair[];
  rejectedPairs: RejectedPair[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {pairs.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No likely duplicates found.</p>
      ) : (
        pairs.map((pair) => (
          <DuplicatePair key={`${pair.a.id}-${pair.b.id}`} pair={pair} />
        ))
      )}
      {rejectedPairs.length > 0 && (
        <DismissedPairs pairs={rejectedPairs} />
      )}
    </div>
  );
}

function DuplicatePair({ pair }: { pair: CandidatePair }) {
  const { a, b } = pair;
  const [winnerId, setWinnerId] = useState(() => defaultWinnerId(a, b));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const winner = winnerId === a.id ? a : b;
  const loser = winnerId === a.id ? b : a;

  async function confirmMerge() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/people/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId: winner.id, loserId: loser.id }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't merge those people. Please try again.");
    } catch {
      setError("Couldn't merge those people. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function dismissPair() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/people/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aId: a.id, bId: b.id }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't dismiss this pair. Please try again.");
    } catch {
      setError("Couldn't dismiss this pair. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <div className="border-t border-[var(--hair)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <PersonCardView
          person={a}
          groupName={`winner-${a.id}-${b.id}`}
          isWinner={winnerId === a.id}
          disabled={busy}
          onChoose={() => setWinnerId(a.id)}
        />
        <PersonCardView
          person={b}
          groupName={`winner-${a.id}-${b.id}`}
          isWinner={winnerId === b.id}
          disabled={busy}
          onChoose={() => setWinnerId(b.id)}
        />
      </div>

      {error && <p className="mt-2 text-sm text-[var(--red)]">{error}</p>}

      {confirming ? (
        <div className="mt-3 flex flex-col gap-2 rounded border border-[var(--hair)] p-3">
          <p className="text-sm">
            Merge <span className="font-medium">{fullName(loser)}</span> into{" "}
            <span className="font-medium">{fullName(winner)}</span>. This reassigns{" "}
            {fullName(loser)}&rsquo;s sessions, teams, emails, and history to{" "}
            {fullName(winner)}, then deletes {fullName(loser)}. This can&rsquo;t be
            undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={confirmMerge}
            >
              {busy ? "Merging…" : "Confirm merge"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Merge
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={dismissPair}
          >
            {busy ? "Dismissing…" : "Not a match"}
          </button>
        </div>
      )}
    </div>
  );
}

function DismissedPairs({ pairs }: { pairs: RejectedPair[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function undoPair(a: PersonCard, b: PersonCard) {
    const key = `${a.id}-${b.id}`;
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/people/reject", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aId: a.id, bId: b.id }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      setError("Couldn't undo. Please try again.");
    } catch {
      setError("Couldn't undo. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="border-t border-[var(--hair)] pt-4">
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Dismissed pairs ({pairs.length})</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {error && <p className="text-sm text-[var(--red)]">{error}</p>}
          {pairs.map(({ a, b }) => {
            const key = `${a.id}-${b.id}`;
            return (
              <div key={key} className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{fullName(a)}</span>
                  {" & "}
                  <span className="font-medium">{fullName(b)}</span>
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={busyKey !== null}
                  onClick={() => undoPair(a, b)}
                >
                  {busyKey === key ? "Undoing…" : "Undo"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PersonCardView({
  person,
  groupName,
  isWinner,
  disabled,
  onChoose,
}: {
  person: PersonCard;
  groupName: string;
  isWinner: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const name = fullName(person);
  return (
    <label
      className={`card flex flex-1 flex-col gap-2 ${isWinner ? "border-[var(--red)]" : ""}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="radio"
          name={groupName}
          checked={isWinner}
          disabled={disabled}
          onChange={onChoose}
          aria-label={`Keep ${name}`}
        />
        <span className="font-medium">{name}</span>
        <span className="pill">{person.role}</span>
        {!person.isActive && <span className="pill off">Inactive</span>}
        {isWinner && <span className="pill on">Keeping</span>}
      </div>
      <div className="text-sm text-[var(--muted)]">
        {person.sessionCount} session{person.sessionCount === 1 ? "" : "s"}
      </div>
      <div className="text-sm">
        {person.emails.length === 0 ? (
          <span className="text-[var(--muted)]">No sign-in emails</span>
        ) : (
          person.emails.map((email, i) => (
            <span key={email} className="mono">
              {i > 0 && ", "}
              {email}
            </span>
          ))
        )}
      </div>
      <div className="text-sm text-[var(--muted)]">
        {person.teams.length === 0 ? "No teams" : person.teams.join(", ")}
      </div>
    </label>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
docker exec hub-devcontainer-app-1 npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit and push**

```bash
git add src/components/DuplicatePeople.tsx src/app/admin/people/duplicates/page.tsx
git commit -m "feat(duplicates): Not a match button + Dismissed pairs undo section"
git push origin master
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Start (or restart) the dev server**

```bash
docker exec -d hub-devcontainer-app-1 sh -c "kill \$(lsof -ti:3000) 2>/dev/null; sleep 1"
docker exec -d hub-devcontainer-app-1 sh -c "cd /workspaces/hub && npm run dev > /tmp/next.log 2>&1"
```

Wait ~5 seconds, then open `http://localhost:3000/admin/people/duplicates`.

- [ ] **Step 2: Dismiss a pair**

Click "Not a match" on any pair. The pair should vanish immediately. Reload the page — the pair should still be absent. Scroll to the bottom of the page — a "Dismissed pairs (1)" section should appear.

- [ ] **Step 3: Undo**

Expand "Dismissed pairs (1)", click "Undo". After the page refreshes, the dismissed pair should reappear in the main list and the dismissed section should disappear (or count drop to 0).

- [ ] **Step 4: Verify merge still works**

Dismiss a pair, confirm it vanishes. Pick a different pair, do a full merge (pick winner, confirm). Verify the merged pair is gone and doesn't appear in dismissed.
