# Recommended team members (Drive group sync page)

**Date:** 2026-08-16
**Status:** Approved design

## Problem

The Drive group sync page reconciles Google Group membership against team
membership. Its "Last reconcile report" already surfaces a "would be removed"
list per team — emails present in a linked team's Google Group but not expected
(not an active member's identity email).

Some of those emails belong to people who already have Drive access, are active,
and simply aren't in the team yet. An admin should be able to see those people
and add them to the team in one place, with an easy bulk action.

## Core insight

The reconcile "expected" set for a team includes **every** identity email of
**every** active member. Therefore any email in a team's `wouldRemove` list that
resolves to an **active person** is provably:

- has Drive access (it's an actual member of the group), and
- is active, and
- is not a member of that team.

That subset is exactly the recommendation set. No inference beyond the existing
report data plus current DB state is required.

## Scope

- One new section on `src/app/admin/drive-sync/page.tsx`: **Recommended
  members**, listing per-team groups of people to add.
- Per-person **Add** button and a per-team **Add all to team** button.
- Recommendations derive from the **last reconcile report** (the user's chosen
  data source) — no live Google Directory calls on page load.

**Out of scope:** notifications, auto-add, inactive-person handling, any new
reconcile behavior.

## Components

### 1. Pure function — `computeAddRecommendations` (`src/lib/drive-group-sync.ts`)

```ts
export type AddRecommendation = {
  personId: string;
  name: string;
  emails: string[]; // this person's matching group emails (>=1), lowercased
};

export type TeamAddRecommendations = {
  teamId: string;
  teamName: string;
  groupEmail: string;
  people: AddRecommendation[];
};

export function computeAddRecommendations(
  report: ReconcileResult,
  groupEmailToTeam: Map<string, { teamId: string; teamName: string }>, // key: lowercased group email
  personByEmail: Map<string, { personId: string; name: string; isActive: boolean }>, // key: lowercased email
  membersByTeam: Map<string, Set<string>>, // teamId -> set of member personIds
): TeamAddRecommendations[];
```

Behavior (PURE):

- For each group report in `report.groups`, resolve its team via
  `groupEmailToTeam` (lowercased key). Skip groups whose email maps to no linked
  team.
- For each email in that group's `wouldRemove`:
  - Look up the person via `personByEmail` (lowercased). Skip if unresolved.
  - Skip if `isActive` is false (checked against **current DB**, not the report).
  - Skip if the person is already in `membersByTeam.get(teamId)`.
  - Otherwise include. **Dedupe by `personId`** within the team — a person with
    multiple matching emails appears once, accumulating all matching emails into
    `emails`.
- Return only teams that have at least one recommendation. Sort teams by name and
  people by name for stable output.

All email keys are lowercased. The report already lowercases `wouldRemove`; the
identity query result may not, so **normalize to lowercase at map-build time**.

**Unit tests** beside the existing `drive-group-sync.test.ts`, covering: unresolved
email skipped; inactive person skipped; already-member skipped; multi-email person
deduped; group with no linked team skipped; teams with zero recommendations omitted.

### 2. Page changes — `src/app/admin/drive-sync/page.tsx`

- Extend the identity query to select `person (id, is_active, first_name,
  last_name)` (currently only first/last name) so we have `personId` and live
  `is_active`.
- Build `personByEmail` (lowercased key → `{ personId, name, isActive }`) and
  `groupEmailToTeam` (lowercased group email → `{ teamId, teamName }`) from the
  already-loaded `linkedTeams`.
- Build `membersByTeam`: one `team_membership` query over the linked team ids,
  aggregated in JS to `teamId -> Set<personId>` (mirrors the existing
  `teamMemberCounts` pattern; avoids the PGRST201 embedded-count path).
- Call `computeAddRecommendations(lastReport, ...)` when a report exists; render
  the new `<RecommendedMembers>` section.

**The current-membership filter is load-bearing, not just a staleness guard.**
After "Add all" succeeds, the stored report is unchanged — those emails are still
in `wouldRemove`. The recommendation list empties on `router.refresh()` *only*
because of the "not already a member" check against live `team_membership`. Do not
remove this filter as "provably redundant against a fresh report" — it is what
makes the UI settle after adds and after any DB drift since the last reconcile.

### 3. New client component — `src/components/RecommendedMembers.tsx`

Props: `{ teams: TeamAddRecommendations[]; ranAt: string }`.

- Renders one section with a freshness note: "based on the sync from
  `{ranAt}`" (formatted as a local date/time) so an admin understands why someone who just lost Drive
  access might still appear (recommendations are only as fresh as the last
  reconcile).
- Per team: the team name, the list of recommended people (name + their matching
  emails, muted), an **Add** button per person, and an **Add all to team** button.
- Add actions call the **existing** endpoint `POST /api/admin/teams/[id]/members`
  with `{ personId }` — **no new API endpoint**.
- **Add all** fires the per-person POSTs **sequentially** (not `Promise.all`):
  each add triggers `syncMembershipChange("add")` → Google Directory calls, and
  sequential execution keeps per-person failures attributable.
- Per-person pending / failed visual state; call `router.refresh()` after the
  batch (or single add) completes so the recomputed page drops the now-added
  people.

`syncMembershipChange("add")` re-inserting someone who is already in the group is
a non-fatal duplicate — the directory layer swallows insert errors, so re-adding an
existing group member does not fail the membership add.

## Data flow

```
last reconcile report (stored)   current DB (people, identities, memberships)
        |                                   |
        | wouldRemove[] per group           | personByEmail, membersByTeam, groupEmailToTeam
        \___________________ computeAddRecommendations ___________________/
                                   |
                        TeamAddRecommendations[]
                                   |
                        <RecommendedMembers>  --Add / Add all-->  POST /api/admin/teams/[id]/members
                                   |                                          |
                              router.refresh() <---- membership filter drops added people
```

## Empty / freshness states

- **No reconcile has ever run** (`lastReport` null): section says a sync must run
  first.
- **Report exists, no recommendations**: section says "No recommendations."
- **Report exists, recommendations present**: render per-team groups with the
  `ranAt` freshness note.

## Error handling

- Individual add failure: mark that person's row failed; do not abort remaining
  people in an "Add all" batch (sequential loop continues).
- The Google side of an add is best-effort via `syncMembershipChange` and never
  throws; the DB membership is the source of truth for whether the add succeeded.

## Testing

- Unit tests for `computeAddRecommendations` (cases listed above).
- Existing reconcile / directory tests remain unchanged.
