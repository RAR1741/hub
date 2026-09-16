# Umbrella team resource inheritance — Design

**Date:** 2026-09-06
**Status:** proposed
**Builds on:** `2026-08-15` Drive group sync (`docs/features/drive-group-sync.md`),
`2026-09-01-github-team-sync-design.md`, `2026-09-02-team-external-accounts-design.md`,
team Slack channels (`docs/features/team-slack-channels.md`)

## 1. Problem and constraints

Teams form a tree (`team.parent_team_id`, self-referential, nullable). Three kinds of external
resource hang off a team: a Google Group (`team.google_group_email`), a GitHub Team
(`team.github_team_slug`), and N Slack channels (`team_slack_channel`). Today every sync computes
"who belongs in this resource" from **direct** `team_membership` rows for that one team.

We want umbrella behaviour: a person who is a member of a team should also be in the external
resources of every **ancestor** of that team. With `FRC Mentors` and `FRC Students` under `FRC`, a
`#frc-all` channel / `frc@` group / `frc` GitHub Team linked to `FRC` should contain everyone in
both children without anyone being added to `FRC` directly.

**Scope is external resources only.** Nothing in-app changes:

- `team_membership` stays flat and direct. No ancestor rows are materialised.
- The team page roster (`listTeamMembers`), `teamMemberCounts`, `memberTeamIds`, the person
  profile's team list (`people.ts`), and the badge gate (`badges.ts`) keep using direct membership
  exactly as today. None of those files are touched.
- No schema change. No migration. (If an implementer finds they need one, stop and flag it; the
  latest migration on `origin/master` is `20260906120000_team_github_sync_allow_inactive.sql`, and a
  new one must take a later version than whatever `origin/master` has *at that moment*, not what the
  local checkout lists.)

Repo posture that this design must preserve, verbatim from the existing syncs: **add aggressively,
remove conservatively.** Reconciles are add-only and *report* `wouldRemove`; the only automatic
removal is the realtime hook for an explicit removal from a linked team. Slack is invite-only with
no removal at all.

Existing architecture, confirmed by reading (`src/lib/*`):

| File | Realtime hook | Reconcile | Notes |
| --- | --- | --- | --- |
| `membership-sync.ts` | `syncMembershipChange(action, teamId, personId, db)` fans out to the three below with `Promise.allSettled` | – | Called from `teams.ts` `upsertMember`/`removeMember`/`joinTeam` |
| `drive-group-sync.ts` | `syncMembershipChange` — add=insert, remove=delete, one group | `reconcileDriveGroups` — per linked team, expected = active members' `person_identity.email` ∪ `team_external_account(provider=google)`, add missing, `wouldRemove` report-only | Realtime remove is the only auto-removal path |
| `github-team-sync.ts` | `syncGithubMembershipChange` — same shape | `reconcileGithubTeams` — expected = members with `github_user_id` (active unless `github_sync_allow_inactive`) ∪ `team_external_account(provider=github)`; login self-heal; add missing; `wouldRemove` report-only | Plus `syncPersonLinkedTeams(personId)` on Connect GitHub |
| `slack-channel-sync.ts` | `syncSlackMembershipChange` — add only, invites to every `team_slack_channel` row of the team, alerts `#hub-admin-alerts` on failure | none | Remove is a no-op by design |
| `team-external-accounts.ts` | `liveSync` on add/remove of a row — one team's group/GitHub Team | folded into both reconciles | |
| `teams.ts` | `buildTeamTree` (PURE, orphans → roots); `updateTeam` blocks only `parentTeamId === id` | – | Deeper cycles (A→B→A) are not guarded; `TeamForm` excludes only self from the parent picker |

Two subtle facts that shape the design:

- `teams.ts` **imports** `membership-sync.ts`. Any tree helper that `membership-sync.ts` needs must
  therefore *not* live in `teams.ts`, or we create a `teams → membership-sync → teams` cycle
  (hoisting makes it "work", which is worse than failing).
- Every test fake in `drive-group-sync.test.ts` / `github-team-sync.test.ts` returns one canned
  result per table regardless of query args and stubs only `select`/`eq`/`not`. Umbrella assertions
  need the fake to see which team ids were asked for.

## 2. Chosen approach: two injection points, one pure helper

Teach the one computation that matters — "who should be in *this team's* external resource" — to
include descendants. Everything else stays as it is.

```
                       reconcile (Drive, GitHub)           realtime hook (all three)
                       ─────────────────────────           ────────────────────────
team X linked to R     expected(R) = ⋃ over subtree(X)     on ADD to team Y:
                         of (direct members ∪                for T in [Y, ...ancestors(Y)]:
                            team_external_account)             sub-sync("add", T, person)
                                                            on REMOVE from team Y:
                                                               sub-sync("remove", Y, person)   ← unchanged
```

- **Reconcile** (Drive, GitHub): a linked team's expected set becomes the union over the team *and
  all its descendants* of direct members + `team_external_account` rows. Nightly, both self-heal.
- **Realtime add** (Drive, GitHub, Slack): on a join to `Y`, run the existing per-team sub-syncs
  for `Y` and for each ancestor of `Y`. Slack has no reconcile, so this walk is the only mechanism
  that fills an umbrella Slack channel.
- **Realtime remove**: unchanged — scoped to the directly changed team only. See §3.3.

### 2.1 Pure tree helper — new `src/lib/team-tree.ts`

```ts
export type TeamLink = { id: string; parentTeamId: string | null };

/** Ids of every ancestor of `teamId`, nearest first. Excludes `teamId`. PURE, cycle-safe. */
export function ancestorIds(teams: TeamLink[], teamId: string): string[];

/** `teamId` plus every descendant, in BFS order. PURE, cycle-safe. */
export function subtreeIds(teams: TeamLink[], teamId: string): string[];
```

- Input is the minimal `{ id, parentTeamId }` so both `Team` (via `listTeams`) and a raw
  `select("id, parent_team_id")` row (mapped inline) fit without a dependency on `types.ts`.
- **Cycle safety:** both walk with a `visited: Set<string>`; a node already visited is skipped.
  This handles self-parenting, A→B→A, and longer loops. A missing parent id (orphan) terminates the
  ancestor walk, matching `buildTeamTree`'s "orphans become roots" rule. No depth cap is needed —
  the visited set bounds the walk at `teams.length` — but the implementer may add a
  `MAX_DEPTH = 32` guard; if so, it's belt-and-suspenders, not the primary defence.
- `teamId` not in `teams` → `ancestorIds` returns `[]`, `subtreeIds` returns `[teamId]`.
- `buildTeamTree` in `teams.ts` is left where it is (it is UI-shaped and imports nothing that
  would cycle). Do not move it.

### 2.2 Loading the tree

One `select("id, parent_team_id")` over the whole `team` table. The table is small (tens of rows);
loading it all is the same shape `buildTeamTree`, `/admin/drive-sync`, and both reconciles already
use. Callers:

- Each reconcile: load once at the top, next to the linked-team query; call `subtreeIds` per linked
  team. Check `error` (AGENTS.md rule); a failed tree read **throws**, aborting the run the same
  way a failed linked-team read already does in `reconcileGithubTeams`. Make the Drive reconcile
  throw too (the cron route already wraps it) rather than fanning the error into every report.
- `membership-sync.ts`: load once per membership change. On `add`, call `ancestorIds` once and
  loop; if the read fails, log and fall back to `[teamId]` so the direct sync still fires (never
  let the umbrella feature *reduce* what happened before). On `remove`, the tree feeds the
  still-effective-member guard in §3.3.

### 2.3 Why not `WITH RECURSIVE` in Postgres

Rejected. Both reconcilers already load all linked teams and iterate in TS; a DB view/function
would add a migration (contrary to "no schema change"), split the logic across two languages, and
be harder to unit-test than a PURE helper with a table-driven `*.test.ts`, which is the repo's
established pattern (`computeGroupDiff`, `computeGithubTeamDiff`, `buildTeamTree`). Cycle guarding
in SQL also needs a path array or depth cap that is easier to get wrong than a `Set`. Revisit only
if the team table grows past a size where one full read per call matters — it won't.

## 3. Decisions

### 3.1 Realtime ADD walk lives in `membership-sync.ts`, not in each sub-sync

```ts
export async function syncMembershipChange(action, teamId, personId, db) {
  const targets = action === "add" ? [teamId, ...(await ancestorsOf(teamId, db))] : [teamId];
  for (const t of targets) {
    await Promise.allSettled([drive(action, t, personId, db), github(action, t, personId, db), slack(action, t, personId, db)]);
  }
}
```

Rationale: the three sub-syncs each take a single `teamId` and look up *that team's* resource
(`google_group_email` / `github_team_slug` / `team_slack_channel` rows). Looping the existing
functions over `[team, ...ancestors]` needs **zero signature changes**, leaves every existing
sub-sync test untouched, and puts the umbrella rule in exactly one readable place. The cost is a
repeated person lookup per ancestor per provider; trees here are two or three levels deep, and
these hooks already tolerate three network calls per join. Not worth optimising.

Iterate ancestors sequentially (one `allSettled` per team) rather than one giant `allSettled`,
so a Slack failure on `FRC` still produces a `#hub-admin-alerts` line naming the right team. The
Slack alert text already includes the team name it was invited for, so an umbrella failure reads
"Couldn't invite Jane to #frc-all for team *FRC*" — accurate, no wording change needed.

`syncMembershipChange` in `membership-sync.ts` needs its own `membership-sync.test.ts` (there is
none today): `vi.mock` the three sub-sync modules, fake a `team` read, and assert call counts and
target ids for add (direct + ancestors, nearest first) vs remove (direct only), plus the
tree-read-failure fallback.

### 3.2 Reconcile expected set = union over the subtree, deduped by person

In both reconcilers the two `.eq("team_id", team.id)` reads (`team_membership` and
`team_external_account`) become `.in("team_id", subtreeIds(tree, team.id))`. Then:

- **Dedupe by person before building `expected`.** Someone in both `FRC` and `FRC Students` comes
  back twice. `computeGroupDiff` happens to dedupe internally, but `expectedCount`, `added`,
  `notConnected`, and the GitHub `diff.missing` loop (double `PUT`) do not. Dedupe on `person.id`
  in GitHub (the row already carries it) and on lowercased email in Drive (dedupe the flattened
  email list; the `Set` in `computeGroupDiff` already does this for the diff — do it once before
  `expectedCount` is read).
- **`github_sync_allow_inactive` is the *linked* team's flag.** It governs the resource being
  filled, so `FRC`'s setting applies to every descendant's members when computing `FRC`'s expected
  set. A descendant's own flag is irrelevant for the ancestor's resource.
- The GitHub `expectedById` map (feeds only the login self-heal) is built from the same deduped
  people list. External rows still stay out of it, per the external-accounts spec.
- `team_external_account` inheritance: **yes**, unioned over the subtree. A bot account attached
  to `FRC Students` belongs in `FRC`'s group and GitHub Team for the same reason a human does. The
  primary key is `(team_id, provider, identifier)`, so the same identifier on two subtree teams is
  two rows; the Drive diff dedupes by email and the GitHub diff by id, so no double-add.

### 3.3 Realtime REMOVE stays scoped to the directly changed team, with a still-effective guard

Removing Jane from `FRC Students` deletes her from `FRC Students`' resources only, exactly as today.
It does **not** walk up to `FRC`.

- She may still be an effective member of `FRC` via a sibling (`FRC Mentors`) or via direct `FRC`
  membership. Cascading removal upward means deciding, unattended, that she has no other path — and
  getting it wrong removes a real member from a shared drive. That is exactly the failure the
  conservative-removal posture exists to prevent.
- The nightly reconcile will list her under `wouldRemove` on `FRC` if she is a true orphan, and a
  human decides. This is the same path every other removal-shaped drift already takes.
- Slack removal was already a no-op; nothing changes there.

**Guard (recommended, one query):** the umbrella creates one case where the *existing* direct
remove hook becomes more aggressive than the feature's own expected set. Jane is in `FRC Students`
and also directly in `FRC`. Once umbrella exists, an admin naturally tidies up by removing her
direct `FRC` row — "she gets it from the sub-team now". Today's hook would then delete her from
`frc@` and the `frc` GitHub Team even though she is still expected there, and she loses shared-drive
access until the nightly reconcile re-adds her. That is the designed common case, not an edge.

So in `membership-sync.ts`, on `remove`, before fanning out:

```ts
// removeMember() has already deleted the row, so any surviving row in the subtree
// means the person is still an effective member of this team's resources.
const { data, error } = await db.from("team_membership").select("team_id")
  .in("team_id", subtreeIds(tree, teamId)).eq("person_id", personId);
if (error || (data ?? []).length > 0) return;   // conservative: skip removal, reconcile reports
```

Skip Drive and GitHub removal when any row survives *or* when the tree/membership read fails
(erring on not-removing, matching the posture). Slack is a no-op regardless. The guard never
cascades upward — it only asks "should the direct removal happen at all?" — so it stays inside the
"scoped to the directly changed team" boundary. Call order is confirmed: `teams.ts` `removeMember`
deletes the row and *then* calls `syncMembershipChange`, so the post-delete subtree query is
correct as written; `teamId`'s own row is already gone.

Pre-existing multi-path cases (two identity emails, an external account matching a person) are
unchanged and out of scope.

### 3.4 `syncPersonLinkedTeams` (Connect GitHub) also PUTs onto ancestors' GitHub Teams

It currently PUTs the newly connected person onto every linked team they are a direct member of.
Change: for each member team, take `[team, ...ancestorIds(tree, team)]`, collect `github_team_slug`
where non-null, **dedupe slugs**, PUT each once. Same tree load as elsewhere. Without this, someone
who connects GitHub while already in `FRC Students` waits until the nightly run to land on `frc`.

### 3.5 `team-external-accounts.ts` `liveSync` add also walks ancestors

For consistency with §3.1: adding a Google/GitHub external account to `FRC Students` should
immediately add it to `FRC`'s group / GitHub Team too. Remove stays scoped to the one team (§3.3
reasoning). Tagged **optional in this PR**: both providers self-heal nightly, so skipping it costs at
most one night. If done, it is mechanical: wrap the existing single-team body in a loop over
`[teamId, ...ancestors]` for `add`, `[teamId]` for `remove`.

### 3.6 Admin pages

- `/admin/drive-sync/page.tsx` has its own `expectedCount(teamId)` that recomputes **direct**
  membership for the "Expected members" column. After this change it would disagree with the
  report's `expectedCount`. Two ways out; **human decision**, recommendation first:
  1. (Recommended, lazy) Delete the page helper and show `lastReport.groups[i].expectedCount`
     for the matching `groupEmail`, "—" when no report exists yet. One source of truth, one fewer
     query per team, no umbrella logic on the page.
  2. Extract the Drive expected-set computation from the reconcile into an exported
     `expectedGroupEmails(db, teamIds)` and call it from both. Keeps a live number but adds an
     export whose only second caller is a table cell.
- `/admin/github-sync/page.tsx` has no equivalent helper (checked) — nothing to do.
- **Recommendations** (`computeAddRecommendations` / `computeGithubAddRecommendations`) keep the
  direct `membersByTeam` filter. Effect: someone who is in the `frc@` group *because* they are in
  `FRC Students` is in `expected`, so never in `wouldRemove`, so never recommended for `FRC`. Correct.
  The one edge: adding a person to `FRC Students` after a reconcile leaves them "recommended" for
  `FRC` until the next run — the same staleness that already exists for direct adds. Accept.

### 3.7 `updateTeam` cycle guard — recommended, human decision

Today `updateTeam` blocks only `parentTeamId === id`, and `TeamForm` excludes only the team itself
from the parent picker, so re-parenting `FRC` under `FRC Students` is reachable from the UI. The
helpers are cycle-safe so nothing loops, but a cycle makes "ancestor" meaningless (every team in
the loop becomes an ancestor of every other) and silently over-invites.

Recommend adding to `updateTeam`: load the tree, reject with `400` if `input.parentTeamId` is in
`subtreeIds(tree, id)` (this subsumes the existing self check). Optionally filter the same set out
of `TeamForm`'s parent options. This is team-CRUD validation, adjacent to the "no in-app changes"
line — hence flagged rather than assumed. It is small and prevents a real footgun; do it unless
told otherwise.

### 3.8 GitHub "leaf teams only" limitation is partially lifted

`docs/features/github-team-sync.md` says link only leaf teams because GitHub's members endpoint
includes child-team members, inflating `wouldRemove`. With umbrella expected sets, a parent hub team
linked to a parent GitHub Team whose GitHub children mirror the hub children now reconciles clean —
the descendants are expected. A `PUT` onto the parent GitHub Team for someone already in a child
GitHub Team makes them a direct parent member too; harmless and idempotent. Soften the doc: "link
parent teams only when the hub tree and the GitHub team nesting match".

## 4. Known gaps (called out, not solved here)

1. **Slack has no backfill.** Invites fire only on a join. Linking a new channel to `FRC` will not
   invite the existing members of `FRC Students`. This gap already exists for direct channels
   (`docs/features/team-slack-channels.md` "No backfill").
2. **Re-parenting is the same gap.** Moving `Pit Crew` under `FRC` invites nobody to `#frc-all`
   until each person next joins something. Drive/GitHub self-heal that night; Slack does not.

Natural follow-up (separate PR): a one-shot **"Invite all effective members"** button on the team
admin page that computes `subtreeIds` → members with `slack_user_id` → `inviteToChannelDetailed`
for each linked channel. It covers both gaps and the pre-existing direct one. Not in scope.

## 5. Alternatives considered

- **Materialise ancestor rows in `team_membership`** (insert a row per ancestor on join). Rejected:
  changes every in-app roster/count/badge query, needs a migration and a backfill, and makes "which
  membership is real" ambiguous. Explicitly out of scope by the brief.
- **Per-sub-sync ancestor walks** (each of the three loads the tree and loops). Rejected: three
  copies of the same walk, three tree reads per join, and three test files to update instead of one
  new one. Centralising in `membership-sync.ts` is strictly less code.
- **Pass an `ancestorIds` array down into each sub-sync.** Rejected: signature churn on three
  functions plus `team-external-accounts.ts` for no behavioural gain over looping the caller.
- **Postgres recursive view.** Rejected, §2.3.
- **Cascade realtime removal up the tree with an "is still effective member?" check.** Rejected,
  §3.3 — it is exactly the unattended-removal risk the existing posture forbids.

## 6. Trade-offs and risks

- **More invites/PUTs per join.** Joining a depth-3 team fires up to 3× the external calls. GitHub
  org invitation budget (50/day new orgs) is the only quota that bites; a mass CSV import into a
  deep subtree could hit it. Mitigation is already present: the reconcile skips people with a
  pending invitation. Watch `#hub-admin-alerts` and the reconcile report the first week.
- **`expectedCount` jumps** for umbrella teams on the sync pages the first night. Expected; mention
  in the PR description so nobody reads it as a bug.
- **Removal guard hides a real removal.** With the §3.3 guard, removing someone's direct row from
  an umbrella team while they remain in a sub-team removes nothing externally — intended, but an
  admin expecting the old "remove = gone" behaviour will only see it in the reconcile report. Note
  it in the feature docs.
- **Fixture rewrite risk.** The reconciler tests' fake db must learn to filter `in("team_id", ids)`
  or the umbrella assertions cannot distinguish teams. This is the one place the coder is most
  likely to stall; §7 specifies the fixture shape.
- **No e2e coverage.** The seed links no team to any external resource, so the existing e2e suite
  cannot exercise this and none is added. Unit tests carry the feature, as they do for the three
  existing syncs.

## 7. Testing plan

New PURE helper tests, table-driven, colocated:

- `src/lib/team-tree.test.ts`
  - `ancestorIds`: linear chain (nearest first), root → `[]`, unknown id → `[]`, orphan parent
    stops the walk, self-cycle terminates, A→B→A terminates and returns each id once, wide tree
    returns only the path (not siblings).
  - `subtreeIds`: leaf → `[id]`, root of a 3-level tree → all ids once, unknown id → `[id]`,
    self-cycle and A→B→A terminate with each id once.

Reconciler tests (`drive-group-sync.test.ts`, `github-team-sync.test.ts`):

- **Fixture change (do this first):** extend `fakeDb` so `in(col, ids)` is recorded and filters
  the table's rows by `row[col] ∈ ids` when rows carry that column; unchanged behaviour when they
  don't. Also add `in` to the stubbed chain methods. Tag `team_membership` /
  `team_external_account` fixture rows with `team_id`. Existing tests keep passing because their
  rows lack `team_id` (no filtering) or use `eq`.
- New assertions:
  - Umbrella team's `expectedCount`/`added` include a descendant's members and a descendant's
    external account; the descendant team's own report includes **only** its own.
  - A person in both parent and child is counted once and PUT/inserted once.
  - GitHub: an inactive member of a child is included in the parent's expected set iff the
    **parent's** `github_sync_allow_inactive` is true.
  - A cyclic tree (A↔B) still produces one report per linked team and terminates.
  - Tree read error: Drive/GitHub reconcile throws and makes no external calls.

`membership-sync.test.ts` (new): `vi.mock` the three sub-syncs; team tree `t3 → t2 → t1`;
`add` on `t3` calls each sub-sync with `t3, t2, t1` in that order; a tree-read failure on `add`
still calls each once with `t3`. `remove` on `t3` with no surviving subtree row calls each exactly
once with `t3`; `remove` on `t1` while a `t3` row survives calls **no** sub-sync; a failed
membership read on `remove` calls no sub-sync.

`github-team-sync.test.ts` `syncPersonLinkedTeams`: member of a child whose parent is linked →
parent slug is PUT; parent and child both linked → both PUT; same slug reachable twice → PUT once.

`teams.test.ts` (if §3.7 is accepted): `updateTeam` rejects `parentTeamId` in own subtree with 400;
accepts a sibling.

`team-external-accounts.test.ts` (if §3.5 is done): add on a child with linked parent hits both;
remove hits only the child.

Gates before PR, per AGENTS.md: `./dev npm run lint`, `typecheck`, `test`, `e2e` (unchanged suite
must still pass).

## 8. Files to change

| File | Change |
| --- | --- |
| `src/lib/team-tree.ts` (new) | `TeamLink`, `ancestorIds`, `subtreeIds` — PURE |
| `src/lib/team-tree.test.ts` (new) | table-driven tests, §7 |
| `src/lib/membership-sync.ts` | load tree; add: loop `[teamId, ...ancestors]`, fallback to `[teamId]` on read error; remove: §3.3 still-effective guard, then `[teamId]` only |
| `src/lib/membership-sync.test.ts` (new) | §7 |
| `src/lib/drive-group-sync.ts` | `reconcileDriveGroups`: tree load, `.in("team_id", subtree)` for both reads, dedupe emails before count |
| `src/lib/github-team-sync.ts` | `reconcileGithubTeams`: same, dedupe by `person.id`, linked team's `allow_inactive`; `syncPersonLinkedTeams`: ancestor slugs, deduped |
| `src/lib/drive-group-sync.test.ts`, `src/lib/github-team-sync.test.ts` | fixture `in` support + umbrella assertions |
| `src/app/admin/drive-sync/page.tsx` | §3.6 — remove `expectedCount()` and read from the report (recommended) |
| `src/lib/teams.ts`, `src/lib/teams.test.ts` | §3.7 cycle guard (recommended, human decision) |
| `src/components/TeamForm.tsx` | §3.7 optional: hide own subtree from parent picker |
| `src/lib/team-external-accounts.ts`, `.test.ts` | §3.5 optional ancestor walk on add |
| `docs/features/drive-group-sync.md`, `github-team-sync.md`, `team-slack-channels.md`, `team-external-accounts.md` | one paragraph each: expected set is the subtree; realtime add walks ancestors; remove is direct-only; Slack backfill/re-parenting gap; soften GitHub leaf-only |
| `docs/features.md` | one line under teams noting umbrella inheritance |

No migration. No API route changes. No component changes beyond the two optional ones.

## 9. Task breakdown (one coder subagent each)

Tags: **M** = mechanical (fully specified, no judgment); **J** = needs judgment.

1. **M** — Create `src/lib/team-tree.ts` with `TeamLink`, `ancestorIds`, `subtreeIds` (visited-set
   cycle guard) and `team-tree.test.ts` covering §7's cases. Run `./dev npm run test -- team-tree`.
2. **M** — Extend `fakeDb` in `drive-group-sync.test.ts` and `github-team-sync.test.ts`: add `in`
   to the chain; when rows carry the filtered column, filter by it. Existing tests must still pass
   unchanged. Commit.
3. **M** — `reconcileDriveGroups`: tree load (throw on `error`), `subtreeIds` per linked team,
   `.in("team_id", …)` on both reads, dedupe emails before `expectedCount`. Add the umbrella
   tests from §7.
4. **J** — `reconcileGithubTeams`: same, dedupe by `person.id`, apply the linked team's
   `github_sync_allow_inactive`. Add umbrella + allow-inactive + cycle tests.
5. **M** — `syncPersonLinkedTeams`: union slugs over each member team's ancestor chain, dedupe,
   PUT once each. Tests per §7.
6. **J** — `membership-sync.ts`: tree load; add: ancestor loop (sequential per team), fallback to
   `[teamId]` on read failure; remove: §3.3 still-effective guard (skip on surviving subtree row or
   read error), then direct team only. New `membership-sync.test.ts` with mocked sub-syncs covering
   all six cases in §7.
7. **J** — `/admin/drive-sync/page.tsx`: apply the §3.6 decision (default: drop the page helper,
   read `expectedCount` from the last report; "—" when none).
8. **J (gated on approval)** — `updateTeam` subtree cycle guard + test; optional `TeamForm` filter.
9. **M (optional)** — `team-external-accounts.ts` `liveSync` ancestor walk on add + tests.
10. **M** — Docs: the four feature docs + `docs/features.md` line, per §8. Run `graphify update .`.

Tasks 1–2 first (everything else depends on them); 3, 4, 5 are independent of each other and of 6;
7 depends on 3's exported shape only if option 2 of §3.6 is chosen. Commit and push after each
task (AGENTS.md).
