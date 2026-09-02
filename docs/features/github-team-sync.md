# GitHub team sync

Teams can be linked to a GitHub Team in the org (`team.github_team_slug`) so the team's active roster
mirrors the GitHub Team's membership automatically. Setup/config: [GitHub App setup](../setup/github-app.md).

## Reconcile (batch, add-only)

**Admin → GitHub team sync** (`/admin/github-sync`) shows every linked team and triggers a reconcile via
its **Sync now** button, which calls `POST /api/admin/github-team/sync`
(`src/app/api/admin/github-team/sync/route.ts` → `reconcileGithubTeams()` in
`src/lib/github-team-sync.ts`). For each team with a `github_team_slug`:

1. Computes the expected member list — every person on that team with a verified GitHub login
   (`person.github_login` and `person.github_user_id`) who is marked active.
2. Lists the GitHub Team's actual members via the GitHub App's installation token (`src/lib/github-teams.ts`).
3. Diffs the two (`computeGithubTeamDiff()`, keyed on GitHub user id) and **adds** anyone expected but missing
   (`putTeamMembership()`) — adds as a direct member if already an org member, or invites as a new org
   member if not yet in the org.
4. Anyone on the GitHub Team but **not** expected is recorded under `wouldRemove` — **never removed**.
   The page renders this as a review list for a human to act on by hand.

Pending org invitations (people invited but not yet accepted) are tracked separately; the reconcile
never re-invites someone who already has an outstanding invitation, avoiding the GitHub org's daily
invitation budget limit (50 for new orgs, 500 for older or paid orgs).

The route is dual-gated: a shared secret (`x-sync-secret` header vs. `app_setting.github_sync_secret`
— empty secret authorizes no one) for the pg_cron job, or a mentor+ session for the button. The
result is saved to `app_setting.github_last_reconcile` and rendered on the page, along with
**Recommended members** (`computeGithubAddRecommendations()`): a `wouldRemove` login that resolves to an
active hub person not currently on that team — i.e. "this person is already in the GitHub Team,
consider adding them to the team instead."

## Real-time sync (the one path that does remove)

Adding or removing someone from a linked team in the hub UI fires `syncGithubMembershipChange()`
immediately — it adds or removes that person's GitHub login from the linked GitHub Team right away,
via the GitHub App's installation token. This **is** an automatic removal path; it's deliberately
separate from the batch reconcile, which only ever reports removals for a human to confirm, to avoid
acting on stale or bad data unattended overnight. A person merged via [duplicate-people merge](merge-duplicate-people.md)
doesn't go through this real-time hook — the next nightly reconcile self-heals the GitHub Team instead.

## Limitations

- **Leaf teams only**: the GitHub API members endpoint includes child-team members. Linking a parent
  team inflates the `wouldRemove` count to include all children's members. Link only leaf teams
  (teams with no sub-teams).
- **Invitation expiry**: GitHub org invitations expire after ~7 days. A pending invite will reappear
  in `missing` on the next nightly run and be re-invited; this is intentional and expected.
- **IdP and Enterprise sync**: on Enterprise accounts with IdP team sync enabled, GitHub's team
  membership endpoints return 403 — this is a GitHub API limitation, not a hub limitation. Regular
  orgs are unaffected.

## Connect GitHub & identity

Membership sync requires verified GitHub identity — a person must link their hub account to their
GitHub login via OAuth ("Connect GitHub" button on their profile). The OAuth callback stores the
GitHub `login` (username) and stable numeric `id`; only the `id` is used thereafter, so renames don't
break existing memberships. Admins never type a login by hand — identity is always verified.

Disconnecting ("Disconnect GitHub" button) clears the stored login and id but does **not** remove the
person from any GitHub Team. They surface in `wouldRemove` on the next reconcile, and an admin removes
them from the hub team (which fires the real hook) if that is intended.

## Source

`src/lib/github-app.ts` (authentication: JWT and installation token), `src/lib/github-teams.ts` (GitHub
API calls: list/add/remove team members), `src/lib/github-team-sync.ts` (diff/reconcile/recommend logic,
fully unit-tested with fake fetch/db).
