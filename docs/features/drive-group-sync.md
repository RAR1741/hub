# Drive / Workspace group sync

Teams can be linked to a Google Workspace Group (`team.google_group_email`) so anything scoped to
that group — Shared Drives, mailing lists — mirrors the team's active roster automatically.
Setup/config: [Google Drive groups setup](../setup/google-drive-groups.md).

## Reconcile (batch, add-only)

**Admin → Drive Sync** (`/admin/drive-sync`) shows every linked team and triggers a reconcile via
its **Sync now** button, which calls `POST /api/admin/drive-group/sync`
(`src/app/api/admin/drive-group/sync/route.ts` → `reconcileDriveGroups()` in
`src/lib/drive-group-sync.ts`). For each team with a `google_group_email`:

1. Computes the expected member list — every linked `person_identity.email` of that team's active
   members (a person can have more than one, e.g. personal + school account; each is its own group
   membership).
2. Lists the group's actual members via the Directory API (`src/lib/google-directory.ts`).
3. Diffs the two (`computeGroupDiff()`, case-insensitive) and **adds** anyone expected but missing
   (`insertGroupMember()`) — idempotent, an "already a member" response counts as success.
4. Anyone in the group but **not** expected is recorded under `wouldRemove` — **never removed**.
   The page renders this as a review list for a human to act on by hand.

The route is dual-gated: a shared secret (`x-sync-secret` header vs. `app_setting.drive_sync_secret`
— empty secret authorizes no one) for the pg_cron job, or a mentor+ session for the button. The
result is saved to `app_setting.drive_last_reconcile` and rendered on the page, along with
**Recommended members** (`computeAddRecommendations()`): a `wouldRemove` email that resolves to an
active hub person not currently on that team — i.e. "this person is already in the Google Group,
consider adding them to the team instead."

## Real-time sync (the one path that does remove)

Adding or removing someone from a linked team in the hub UI fires `syncMembershipChange()`
immediately — it inserts or deletes that person's identity email(s) from the linked Google Group
right away, via the same Directory API helpers. This **is** an automatic removal path; it's
deliberately separate from the batch reconcile, which only ever reports removals for a human to
confirm, to avoid acting on stale or bad data unattended overnight. A person merged via
[duplicate-people merge](merge-duplicate-people.md) doesn't go through this real-time hook — the
next nightly reconcile self-heals the group instead.

## Source

`src/lib/drive-group-sync.ts` (diff/reconcile/recommend logic, fully unit-tested with fake
fetch/db) and `src/lib/google-directory.ts` (Directory API calls: list/insert/delete group member,
domain-wide-delegated service-account auth).
