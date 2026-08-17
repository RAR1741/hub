# Reject a duplicate-pair suggestion

**Date:** 2026-08-16
**Status:** Approved (design)

## Problem

The admin "Find duplicates" page (`/admin/people/duplicates`) recomputes candidate
pairs on the fly from name similarity (`findDuplicateCandidates`) every time it
loads. There is no persistence of a decision *other than merge*. Two genuinely
distinct people with similar names — siblings, twins, two "John Smith"s — score
above threshold and therefore reappear on the list on every visit, forever. An
admin has no way to say "these are not the same person" and make the suggestion
go away.

## Goal

Let an admin permanently dismiss a duplicate-pair suggestion so it never appears
on the list again, while keeping the decision reversible (an admin can undo a
dismissal if they change their mind).

## Data model

New table `person_merge_rejection`, one row per suppressed pair:

| column        | type          | notes                                                        |
| ------------- | ------------- | ------------------------------------------------------------ |
| `a`           | uuid          | lexicographically-smaller person id (matches `DupCandidate`) |
| `b`           | uuid          | larger person id                                             |
| `rejected_by` | uuid          | admin who dismissed the pair                                 |
| `created_at`  | timestamptz   | default `now()`                                              |

- **Primary key `(a, b)`.** The pair is keyed on the ordered id pair using the
  same `a < b` rule `findDuplicateCandidates` already applies, so one row
  uniquely identifies a pair regardless of scan order. Keying on ids (not names)
  means a later name edit never resurfaces a dismissed pair.
- `a` and `b` are `references person(id) on delete cascade`. If either person is
  later deleted or merged away, the rejection row is auto-removed — no dangling
  rows, and if that person is re-created the pair is legitimately re-evaluated.
- `rejected_by` references `person(id)` (nullable / `on delete set null` so an
  admin's own deletion doesn't cascade away the rejection).
- Follows the house RLS pattern: `enable row level security`, no policies
  (default-deny), `grant all on person_merge_rejection to service_role`.

Delivered as a committed migration file (migrations-as-code; never edited in
place once applied).

## Filtering

`listDuplicateCandidates` (`src/lib/merge-people.ts`):

1. Compute `candidates` from `findDuplicateCandidates` as today.
2. Load all rejected pairs into a `Set<string>` keyed `` `${a}|${b}` ``.
3. Filter suppressed pairs out of `candidates` **before** the `.slice(0, MAX_PAIRS)`
   cap and before the email/session/team enrichment queries, so dismissed pairs
   neither occupy a slot in the top-100 nor incur enrichment cost.

A companion `listRejectedPairs(db?)` loads the dismissed pairs with both people's
names for the undo surface (batched name lookup over the union of `a`/`b` ids).

## API

One route: `src/app/api/admin/people/reject/route.ts`, admin-gated via
`withRole("admin", ...)` exactly like the merge route.

- **`POST`** `{ aId, bId }` — validate both with `reqString(..., 64)`; reject
  self-pair (`aId === bId`) with 400. Normalize into `(a, b)` order server-side.
  Upsert the row with `on conflict (a, b) do nothing`. 200 on success.
- **`DELETE`** `{ aId, bId }` (undo) — normalize and delete the matching row.
  Idempotent: deleting a non-existent rejection is a 200.

Business logic lives in `merge-people.ts` as `rejectPair(aId, bId, rejectedBy, db?)`
and `unrejectPair(aId, bId, db?)`, mirroring the existing `mergePeople` shape
(`{ ok, status }`).

## UI (`src/components/DuplicatePeople.tsx`)

- Beside the existing **Merge** button, add a **"Not a match"** button. Clicking
  it POSTs to the reject route, then the pair disappears via the same
  `done` / `router.refresh()` path merge uses. No confirmation step — the action
  is non-destructive and undoable.
- On error, surface the same inline error treatment merge uses.

**Undo surface** — a collapsible **"Dismissed pairs (N)"** section rendered at the
bottom of the duplicates page (`page.tsx` passes `rejectedPairs` from
`listRejectedPairs`). Each entry shows both people's names and an **Undo** button
that DELETEs the rejection and refreshes. When there are zero dismissed pairs the
section is omitted.

## Error handling

- Invalid / missing ids → 400.
- Self-pair → 400 (defense in depth; UI never sends one).
- Both people missing is not specially handled: an upsert of ids that don't exist
  fails the FK and returns 500, but the UI only ever rejects pairs it just
  rendered, so this is a defensive 500, not an expected path.
- DELETE of a non-existent rejection → 200 (idempotent undo).

## Testing

- **Unit (`merge-people.test.ts` / a new sibling):** `listDuplicateCandidates`
  filters out a rejected pair; the filter runs before the `MAX_PAIRS` cap;
  `rejectPair` normalizes id order so `(x,y)` and `(y,x)` collapse to one row and
  a double-reject is idempotent; `unrejectPair` removes it; `listRejectedPairs`
  returns both names.
- **E2E:** reject a rendered pair → it vanishes and stays gone after reload →
  appears under "Dismissed pairs" → undo → it returns to the candidate list.

## Out of scope

- No bulk reject / reject-all.
- No audit log beyond `rejected_by` / `created_at` on the row.
- No expiry or re-surfacing of dismissed pairs over time.
