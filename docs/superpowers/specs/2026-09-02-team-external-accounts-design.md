# Team external accounts — design

Status: proposed
Templates: Drive group sync (`docs/features/drive-group-sync.md`), GitHub team sync
(`docs/features/github-team-sync.md`)

## 1. Problem and constraints

Some accounts that belong on a team's Google Group or GitHub Team are not people. They are
role/service accounts owned by the team: `rarpo@redalert1741.org` (Google Drive),
`@rar1741programmer` (GitHub), and a handful of others. Today both reconciles compute the
expected member list purely from `team_membership`, so these accounts sit permanently in
`wouldRemove` on `/admin/drive-sync` and `/admin/github-sync`. That noise is a big part of why
automatic removals are still off.

Decisions already made (do not re-open):

1. **No person row.** A person's emails are the OAuth allowlist, so a "bot person" would be a
   login. `person_role` is a Postgres enum and 23 non-test files query `person`; every one would
   need an `is_bot` filter. Rejected.
2. **Team-scoped rows, not a standalone entity.** A handful of accounts, low turnover. A bot on
   three teams is three rows. A `label` column groups the Google and GitHub identifiers of the
   same role in the UI. If the count ever grows past a dozen, one migration adds an
   `external_account` table and backfills from distinct labels; nothing is lost.
3. **Admin-typed GitHub login, resolved to the stable numeric id at save time** via the GitHub
   App installation token. This is a deliberate exception to "admins never type a login": the
   account is team-owned, so ownership verification adds nothing. The "id is the key, login is
   display" invariant still holds.
4. **These accounts never log in** and never appear anywhere outside the team admin page and the
   two sync pages. A human who holds the role gets their own person row for hub access.
5. **Admin-only** management. The team admin page and its membership API are already
   `withRole("admin")`; the new section and route use the same gate.
6. **Removal is immediate**, matching the existing real-time membership hook. Deleting a row
   removes the identifier from the Google Group / GitHub Team right away.

Repo constraints that shape the design:

- Every schema change is a new migration under `supabase/migrations/`; never edit an applied
  one. Latest is `20260901120000_github_team_sync.sql`; this one is `20260902120000_…`.
- Tables are RLS with zero policies; a **new table** needs `grant all … to service_role`.
- Always check `error` on `.select()`.
- Leaf-teams-only limitation for GitHub still applies (GitHub's members endpoint includes child
  teams).

## 2. Schema

`supabase/migrations/20260902120000_team_external_account.sql`:

```sql
create table team_external_account (
  team_id uuid not null references team (id) on delete cascade,
  provider text not null check (provider in ('google', 'github')),
  -- Google: the email. GitHub: the login. Always lowercased, matching person_identity.
  identifier text not null check (identifier = lower(identifier)),
  -- Stable key for GitHub rows (logins can be renamed). Required for github, null for google.
  github_user_id bigint
    check ((provider = 'github') = (github_user_id is not null)),
  -- Human-readable grouping, e.g. "Programming bot". Shown in the admin UI.
  label text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, provider, identifier)
);

alter table team_external_account enable row level security;
grant all on team_external_account to service_role;
```

No changes to `team`, `person`, or `person_identity`.

## 3. Library: `src/lib/team-external-accounts.ts` (new)

```ts
export type Provider = "google" | "github";
export type TeamExternalAccountRow = {
  team_id: string; provider: Provider; identifier: string;
  github_user_id: number | null; label: string; created_at: string;
};

listTeamExternalAccounts(teamId, db?)             // ordered by label, provider
addTeamExternalAccount(teamId, input, deps?)      // validate → resolve → insert → live sync
removeTeamExternalAccount(teamId, provider, identifier, deps?) // delete → live sync
```

`addTeamExternalAccount` behaviour:

1. Validate: `label` non-empty (≤ 80 chars); `identifier` trimmed and lowercased; for `google`
   it must contain `@`; for `github` it must match GitHub's login rules (`^[a-z0-9-]{1,39}$`,
   no leading/trailing hyphen). Otherwise `{ ok: false, status: 400 }`.
2. For `github`: `GET https://api.github.com/users/{login}` with the installation token
   (new helper `getUserByLogin()` in `src/lib/github-teams.ts`, same `GithubDeps` shape). 404
   → `{ ok: false, status: 404, reason: "github_user_not_found" }`. Store the returned `id`
   and the returned `login` lowercased (GitHub logins are case-insensitive).
3. Insert. Unique violation `23505` → `{ ok: false, status: 409 }`.
4. Live sync, best-effort like `syncMembershipChange()` / `syncGithubMembershipChange()`: if the
   team has a `google_group_email` and provider is `google`, `insertGroupMember()`; if the team
   has a `github_team_slug` and provider is `github`, `putTeamMembership()`. Failures are
   logged, not returned as errors; the nightly reconcile self-heals. If the team is not linked
   for that provider the row is still stored and takes effect when the team is linked.

`removeTeamExternalAccount` mirrors this with `deleteGroupMember()` / `deleteTeamMembership()`.

Dependency injection follows the existing sync modules: a `deps` object carrying `db`, `fetch`,
and the token getters so unit tests use fakes.

## 4. Reconcile changes

Both reconciles read `team_external_account` for the team and union into `expected` at the one
place each already builds it:

- `src/lib/drive-group-sync.ts` `reconcileDriveGroups()`: after the membership `flatMap`,
  append `identifier` for rows with `provider = 'google'`. The diff is already
  case-insensitive.
- `src/lib/github-team-sync.ts` `reconcileGithubTeams()`: after `expected` is built, append
  `{ id: github_user_id, login: identifier }` for rows with `provider = 'github'`. Do **not**
  add them to `expectedById`: that map feeds only the login self-heal loop, which writes
  `person.github_login`, and it already skips ids it does not know (`if (!person) continue`).
  `computeGithubTeamDiff()` keys on `expected` by id, so no other change is needed. Pending
  invitations are matched by login case-insensitively already, so the lowercased identifier
  is safe. A renamed bot login leaves `identifier` stale for display only; the id still
  matches, so sync stays correct. Self-healing that column is skipped for v1.

External rows are not people, so they must not feed `notConnected`, "recommended members", or
the PR #239 "assign to person" picker. Because they are in `expected`, they never reach
`wouldRemove` and those paths never see them. The reconcile report gains no new field; the
count fields (`expectedCount`) include them, which is correct.

Read the external rows with `.select("*").eq("team_id", team.id)` and check `error`; a read
failure is pushed to `report.errors` and the team is skipped, same as the membership read.

## 5. API: `src/app/api/admin/teams/[id]/external-accounts/route.ts` (new)

Both handlers `withRole<Ctx>("admin", …)`, matching the sibling `members/route.ts`.

- `POST` body `{ provider, identifier, label }` → `addTeamExternalAccount`. Maps `status` from
  the lib result; 404 includes `{ error: "github_user_not_found" }` so the form can say so.
- `DELETE` body `{ provider, identifier }` → `removeTeamExternalAccount`.

## 6. Admin UI: team page section

`src/app/admin/teams/[id]/page.tsx` already redirects non-admins. Add a third `<section
className="card">` titled **External accounts** below the members section, rendered by a new
client component `src/components/ExternalAccountManager.tsx` (same shape as `MemberManager`):

- Table grouped by `label`: label, provider badge, identifier (GitHub rows show `@login`), and
  a **Remove** button per row.
- Add form: `label` text input, `provider` `<select>`, `identifier` text input, **Add** button.
  Errors shown inline: 400 "Invalid identifier", 404 "No GitHub user with that login",
  409 "Already added".
- A one-line hint under the form: "These accounts are added to the linked Google Group / GitHub
  Team but never get hub access." If the team has neither `google_group_email` nor
  `github_team_slug`, the hint says the rows take effect once the team is linked.

No changes to `/admin/drive-sync` or `/admin/github-sync` beyond the counts already reflecting
the union.

## 7. Testing

Unit (Vitest, fake db + fake fetch, existing patterns in `drive-group-sync.test.ts` and
`github-team-sync.test.ts`):

- `team-external-accounts.test.ts`: validation table (bad email, bad login, empty label);
  GitHub 404 → `github_user_not_found`; login stored lowercased with the API's id; 23505 → 409;
  live sync called only when the team is linked for that provider; live sync failure does not
  fail the add.
- `drive-group-sync.test.ts`: a `google` external row in the group is not in `wouldRemove`; one
  missing from the group is in `added`; a `github` row is ignored by the Drive reconcile.
- `github-team-sync.test.ts`: mirror of the above; an external row does not appear in
  `notConnected` or in `computeGithubAddRecommendations()` output.

E2E (Playwright, existing admin dev-login): on a team page, add a Google external account, see
it in the External accounts table, remove it, see it gone. The e2e team is unlinked (the seed
links no team to a Google Group or GitHub Team), so no live sync fires and no credentials are
needed. `syncMembershipChange()` already wraps the whole call, token fetch included, in
try/catch, so a linked team without creds would only log; the GitHub live sync must do the same.

## 8. Docs

- New `docs/features/team-external-accounts.md` (short) and a one-line entry in
  `docs/features.md`.
- `docs/features/drive-group-sync.md` and `docs/features/github-team-sync.md`: one sentence each
  in "Reconcile" step 1 noting external accounts are unioned in, with a link.
- `docs/features/github-team-sync.md` "Connect GitHub & identity": note the admin-typed
  exception for team-owned accounts.

## 9. Out of scope

- Turning on automatic removals. That is a separate decision once `wouldRemove` is empty in
  practice.
- A "keep as external account" action on the `wouldRemove` rows of the reconcile reports
  (natural follow-up beside PR #239's "assign to person" picker; not needed for v1).
- A standalone external-account entity or a central management page (see decision 2).
- Slack, FIRST, or any other provider. The `provider` check constraint is extended by a new
  migration when one is needed.
