# Recommended Team Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Recommended members" section to the Drive group sync admin page that lists active people who already have Drive access to a linked team's Google Group but aren't team members, with per-person and "Add all to team" buttons.

**Architecture:** A pure function derives per-team recommendations from the last stored reconcile report's `wouldRemove` list cross-referenced with current DB state (active people, current memberships). The server page builds the lookup maps and renders a client component that adds members via the existing `POST /api/admin/teams/[id]/members` endpoint.

**Tech Stack:** Next.js App Router (server + client components), Supabase (`@supabase/supabase-js`), Vitest, TypeScript.

## Global Constraints

- Email comparison is **case-insensitive**; all map keys are **lowercased**.
- No new API endpoint — reuse `POST /api/admin/teams/[id]/members` with `{ personId }`.
- "Add all" fires per-person adds **sequentially**, never `Promise.all`.
- The "not already a member" filter is **load-bearing** and must not be removed.
- Follow existing patterns: `getDb()`, `withRole`, JS-side aggregation over `team_membership` (avoid PGRST201 embedded-count path), CSS classes `card`/`btn`/`btn-primary`/`table`/`mono`/`text-[var(--muted)]`/`text-[var(--red)]`.

---

### Task 1: `computeAddRecommendations` pure function + tests

**Files:**
- Modify: `src/lib/drive-group-sync.ts` (append types + function; do not touch existing exports)
- Test: `src/lib/drive-group-sync.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: existing `ReconcileResult` / `GroupReconcileReport` types from this file.
- Produces:
  ```ts
  export type AddRecommendation = { personId: string; name: string; emails: string[] };
  export type TeamAddRecommendations = {
    teamId: string; teamName: string; groupEmail: string; people: AddRecommendation[];
  };
  export function computeAddRecommendations(
    report: ReconcileResult,
    groupEmailToTeam: Map<string, { teamId: string; teamName: string }>,
    personByEmail: Map<string, { personId: string; name: string; isActive: boolean }>,
    membersByTeam: Map<string, Set<string>>,
  ): TeamAddRecommendations[];
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/drive-group-sync.test.ts`:

```ts
import { computeAddRecommendations } from "./drive-group-sync";
import type { ReconcileResult } from "./drive-group-sync";

describe("computeAddRecommendations", () => {
  const report = (groups: Partial<ReconcileResult["groups"][number]>[]): ReconcileResult => ({
    ranAt: "2026-08-16T00:00:00Z",
    groups: groups.map((g) => ({
      teamName: "T", groupEmail: "g@x.org", expectedCount: 0, actualCount: 0,
      added: [], wouldRemove: [], errors: [], ...g,
    })),
  });
  const g2t = new Map([["team-a@x.org", { teamId: "t1", teamName: "Team A" }]]);

  test("recommends an active, resolved, non-member person", () => {
    const r = report([{ groupEmail: "team-a@x.org", wouldRemove: ["bob@x.com"] }]);
    const people = new Map([["bob@x.com", { personId: "p1", name: "Bob", isActive: true }]]);
    const members = new Map<string, Set<string>>();
    expect(computeAddRecommendations(r, g2t, people, members)).toEqual([
      { teamId: "t1", teamName: "Team A", groupEmail: "team-a@x.org",
        people: [{ personId: "p1", name: "Bob", emails: ["bob@x.com"] }] },
    ]);
  });

  test("skips unresolved emails, inactive people, and current members", () => {
    const r = report([{ groupEmail: "team-a@x.org",
      wouldRemove: ["ghost@x.com", "old@x.com", "mem@x.com"] }]);
    const people = new Map([
      ["old@x.com", { personId: "p2", name: "Old", isActive: false }],
      ["mem@x.com", { personId: "p3", name: "Mem", isActive: true }],
    ]);
    const members = new Map([["t1", new Set(["p3"])]]);
    expect(computeAddRecommendations(r, g2t, people, members)).toEqual([]);
  });

  test("dedupes a multi-email person into one entry with all emails", () => {
    const r = report([{ groupEmail: "TEAM-A@x.org", wouldRemove: ["A@x.com", "b@x.com"] }]);
    const people = new Map([
      ["a@x.com", { personId: "p1", name: "Bob", isActive: true }],
      ["b@x.com", { personId: "p1", name: "Bob", isActive: true }],
    ]);
    const out = computeAddRecommendations(r, g2t, people, new Map());
    expect(out[0].people).toEqual([{ personId: "p1", name: "Bob", emails: ["a@x.com", "b@x.com"] }]);
  });

  test("omits groups with no linked team and teams with no recommendations", () => {
    const r = report([{ groupEmail: "unlinked@x.org", wouldRemove: ["bob@x.com"] }]);
    const people = new Map([["bob@x.com", { personId: "p1", name: "Bob", isActive: true }]]);
    expect(computeAddRecommendations(r, g2t, people, new Map())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec app npx vitest run src/lib/drive-group-sync.test.ts`
Expected: FAIL — `computeAddRecommendations is not a function` / not exported.

- [ ] **Step 3: Implement the function**

Append to `src/lib/drive-group-sync.ts`:

```ts
export type AddRecommendation = { personId: string; name: string; emails: string[] };
export type TeamAddRecommendations = {
  teamId: string;
  teamName: string;
  groupEmail: string;
  people: AddRecommendation[];
};

/**
 * Derive "add these people to the team" recommendations from the last reconcile
 * report. A recommendation is a wouldRemove email that resolves to an ACTIVE
 * person who is NOT currently a member of that team. PURE. Keys are lowercased.
 *
 * The current-membership filter is load-bearing: after an add, the stored report
 * still lists the email in wouldRemove, so this filter is what drops added people
 * on the next page load. Do not remove it as "redundant".
 */
export function computeAddRecommendations(
  report: ReconcileResult,
  groupEmailToTeam: Map<string, { teamId: string; teamName: string }>,
  personByEmail: Map<string, { personId: string; name: string; isActive: boolean }>,
  membersByTeam: Map<string, Set<string>>,
): TeamAddRecommendations[] {
  const out: TeamAddRecommendations[] = [];
  for (const group of report.groups) {
    const team = groupEmailToTeam.get(group.groupEmail.toLowerCase());
    if (!team) continue;
    const members = membersByTeam.get(team.teamId) ?? new Set<string>();
    const byPerson = new Map<string, AddRecommendation>();
    for (const rawEmail of group.wouldRemove) {
      const email = rawEmail.toLowerCase();
      const person = personByEmail.get(email);
      if (!person || !person.isActive) continue;
      if (members.has(person.personId)) continue;
      const existing = byPerson.get(person.personId);
      if (existing) {
        existing.emails.push(email);
      } else {
        byPerson.set(person.personId, { personId: person.personId, name: person.name, emails: [email] });
      }
    }
    if (byPerson.size === 0) continue;
    const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
    out.push({ teamId: team.teamId, teamName: team.teamName, groupEmail: group.groupEmail, people });
  }
  return out.sort((a, b) => a.teamName.localeCompare(b.teamName));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec app npx vitest run src/lib/drive-group-sync.test.ts`
Expected: PASS (all `computeAddRecommendations` cases + existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/drive-group-sync.ts src/lib/drive-group-sync.test.ts
git commit -m "feat(drive-sync): computeAddRecommendations pure function"
git push
```

---

### Task 2: `RecommendedMembers` client component

**Files:**
- Create: `src/components/RecommendedMembers.tsx`

**Interfaces:**
- Consumes: `TeamAddRecommendations` from `@/lib/drive-group-sync` (Task 1).
- Produces: `export function RecommendedMembers(props: { teams: TeamAddRecommendations[]; ranAt: string })`.

- [ ] **Step 1: Create the component**

Create `src/components/RecommendedMembers.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamAddRecommendations } from "@/lib/drive-group-sync";

type RowState = "idle" | "adding" | "failed";

export function RecommendedMembers({
  teams,
  ranAt,
}: {
  teams: TeamAddRecommendations[];
  ranAt: string;
}) {
  const router = useRouter();
  // key: `${teamId}:${personId}` -> row state
  const [state, setState] = useState<Record<string, RowState>>({});
  const [busyTeam, setBusyTeam] = useState<string | null>(null);

  function keyFor(teamId: string, personId: string) {
    return `${teamId}:${personId}`;
  }

  async function addOne(teamId: string, personId: string): Promise<boolean> {
    const k = keyFor(teamId, personId);
    setState((s) => ({ ...s, [k]: "adding" }));
    try {
      const res = await fetch(`/api/admin/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (res.ok) return true;
      setState((s) => ({ ...s, [k]: "failed" }));
      return false;
    } catch {
      setState((s) => ({ ...s, [k]: "failed" }));
      return false;
    }
  }

  async function addOneAndRefresh(teamId: string, personId: string) {
    const ok = await addOne(teamId, personId);
    if (ok) router.refresh();
  }

  async function addAll(team: TeamAddRecommendations) {
    if (busyTeam) return;
    setBusyTeam(team.teamId);
    let anyOk = false;
    // Sequential: each add triggers a Google Directory call; keeps failures attributable.
    for (const p of team.people) {
      const ok = await addOne(team.teamId, p.personId);
      anyOk = anyOk || ok;
    }
    setBusyTeam(null);
    if (anyOk) router.refresh();
  }

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Recommended members</h2>
        <p className="text-sm text-[var(--muted)]">
          People with Drive access who are active but not on the team. Based on the sync from{" "}
          <span className="mono">{new Date(ranAt).toLocaleString()}</span>.
        </p>
      </div>

      {teams.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No recommendations.</p>
      ) : (
        teams.map((team) => (
          <div
            key={team.teamId}
            className="flex flex-col gap-2 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{team.teamName}</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyTeam === team.teamId}
                onClick={() => addAll(team)}
              >
                {busyTeam === team.teamId ? "Adding…" : "Add all to team"}
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {team.people.map((p) => {
                const st = state[keyFor(team.teamId, p.personId)] ?? "idle";
                return (
                  <li key={p.personId} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      {p.name}{" "}
                      <span className="mono text-[var(--muted)]">({p.emails.join(", ")})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {st === "failed" && <span className="text-xs text-[var(--red)]">failed</span>}
                      <button
                        type="button"
                        className="btn"
                        disabled={st === "adding" || busyTeam === team.teamId}
                        onClick={() => addOneAndRefresh(team.teamId, p.personId)}
                      >
                        {st === "adding" ? "Adding…" : "Add"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `docker compose exec app npx tsc --noEmit`
Expected: PASS (no type errors from the new file).

- [ ] **Step 3: Commit**

```bash
git add src/components/RecommendedMembers.tsx
git commit -m "feat(drive-sync): RecommendedMembers client component"
git push
```

---

### Task 3: Wire recommendations into the Drive group sync page

**Files:**
- Modify: `src/app/admin/drive-sync/page.tsx`

**Interfaces:**
- Consumes: `computeAddRecommendations` + `TeamAddRecommendations` (Task 1), `RecommendedMembers` (Task 2).
- Produces: rendered section on the page. No exports.

- [ ] **Step 1: Extend the identity query and imports**

In `src/app/admin/drive-sync/page.tsx`:

Update the imports at the top:

```ts
import { computeAddRecommendations } from "@/lib/drive-group-sync";
import type { ReconcileResult } from "@/lib/drive-group-sync";
import { RecommendedMembers } from "@/components/RecommendedMembers";
```

Change the identity query (currently selects `email, person (first_name, last_name)`) to also fetch `id` and `is_active`:

```ts
const { data: identityRows } = await db
  .from("person_identity")
  .select("email, person (id, is_active, first_name, last_name)");
```

Replace the loop that builds `nameByEmail` with one that builds BOTH `nameByEmail`
(unchanged shape, used by `ReconcileReport`) and `personByEmail`:

```ts
const nameByEmail: Record<string, string> = {};
const personByEmail = new Map<string, { personId: string; name: string; isActive: boolean }>();
for (const row of (identityRows ?? []) as unknown as {
  email: string;
  person:
    | { id: string; is_active: boolean; first_name: string; last_name: string }
    | { id: string; is_active: boolean; first_name: string; last_name: string }[]
    | null;
}[]) {
  const p = Array.isArray(row.person) ? row.person[0] : row.person;
  if (!p) continue;
  const name = `${p.first_name} ${p.last_name}`;
  nameByEmail[row.email] = name;
  personByEmail.set(row.email.toLowerCase(), { personId: p.id, name, isActive: p.is_active });
}
```

- [ ] **Step 2: Build the membership + group-email maps and compute recommendations**

After `peoplePicker` is built (and before the `return`), add:

```ts
// teamId -> set of current member personIds, over the linked teams only.
const linkedTeamIds = linkedTeams.map((t) => t.id);
const membersByTeam = new Map<string, Set<string>>();
if (linkedTeamIds.length > 0) {
  const { data: memberRows } = await db
    .from("team_membership")
    .select("team_id, person_id")
    .in("team_id", linkedTeamIds);
  for (const row of (memberRows ?? []) as { team_id: string; person_id: string }[]) {
    const set = membersByTeam.get(row.team_id) ?? new Set<string>();
    set.add(row.person_id);
    membersByTeam.set(row.team_id, set);
  }
}

// lowercased group email -> team.
const groupEmailToTeam = new Map<string, { teamId: string; teamName: string }>();
for (const t of linkedTeams) {
  if (t.googleGroupEmail) {
    groupEmailToTeam.set(t.googleGroupEmail.toLowerCase(), { teamId: t.id, teamName: t.name });
  }
}

const recommendations = lastReport
  ? computeAddRecommendations(lastReport, groupEmailToTeam, personByEmail, membersByTeam)
  : [];
```

- [ ] **Step 3: Render the section**

Add this JSX immediately after the "Last reconcile report" `<section>` (before `</main>`):

```tsx
{lastReport ? (
  <RecommendedMembers teams={recommendations} ranAt={lastReport.ranAt} />
) : (
  <section className="card flex flex-col gap-2">
    <h2 className="text-base font-semibold">Recommended members</h2>
    <p className="text-sm text-[var(--muted)]">Run a sync first to see recommendations.</p>
  </section>
)}
```

- [ ] **Step 4: Verify typecheck and lint pass**

Run: `docker compose exec app npx tsc --noEmit && docker compose exec app npm run lint`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Start (or confirm) the dev stack, open `/admin/drive-sync` as an admin. Confirm:
- With no prior reconcile: section shows "Run a sync first…".
- After a reconcile that has a `wouldRemove` email resolving to an active non-member: that person appears; "Add" adds them and they disappear on refresh; "Add all to team" adds everyone sequentially.

Run: `docker compose exec app npx vitest run`
Expected: PASS (full suite).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/drive-sync/page.tsx
git commit -m "feat(drive-sync): recommended members section on sync page"
git push
```

---

## Self-Review

**Spec coverage:**
- Pure `computeAddRecommendations` + tests → Task 1. ✓
- Extend identity query for `id` + `is_active` → Task 3 Step 1. ✓
- `membersByTeam` via JS aggregation → Task 3 Step 2. ✓
- Load-bearing membership filter (documented + implemented) → Task 1 Step 3 docstring + code. ✓
- Dedupe by personId → Task 1 test + code. ✓
- Client component, per-person + Add all, sequential, existing endpoint, router.refresh → Task 2. ✓
- Freshness note (`ranAt`) → Task 2. ✓
- Empty states (no report / no recommendations) → Task 2 (no recs) + Task 3 Step 3 (no report). ✓
- Out of scope (notifications, auto-add, inactive handling) → not present. ✓

**Placeholder scan:** No TBD/TODO; all steps contain concrete code. ✓

**Type consistency:** `TeamAddRecommendations`/`AddRecommendation` shape identical across Tasks 1–3; `computeAddRecommendations` signature matches its call in Task 3; `personByEmail` value shape (`personId`/`name`/`isActive`) consistent. ✓
