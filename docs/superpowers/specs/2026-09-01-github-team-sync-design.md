# GitHub team sync — design

Status: proposed
Issue: #79 "Add GitHub team integration"
Template: Drive group sync (`src/lib/drive-group-sync.ts`, `docs/features/drive-group-sync.md`)

## 1. Problem and constraints

Hub teams already mirror to Google Groups. Mentors want the same for GitHub: a hub team
linked to a GitHub Team inside the org (`RAR1741`), with the hub as the source of truth for
who should be on it, a nightly reconcile that adds missing people, a real-time hook on
membership changes, and a "recommended members" reverse flow.

Decisions already made (do not re-open):

1. Sync target is a **GitHub Team** in the org (hub `team` <-> GitHub `team_slug`), not org
   membership or custom roles.
2. Identity is a **verified "Connect GitHub" OAuth flow** that stores the person's GitHub
   `login` plus stable numeric `id`. Admins never type a login by hand.
3. Admin operations use an **org-owned GitHub App** and its installation token.
4. Full Drive parity including the reverse **recommended members** flow.

Repo constraints that shape the design:

- Every schema change is a new migration under `supabase/migrations/`; never edit an applied
  one. Latest is `20260830120000_event_slack_channels.sql`; this one is `20260901120000_…`.
- Tables are RLS with zero policies; a **new table** needs `grant all … to service_role`. This
  design adds **no new tables**, only columns on `team` and `person`, which inherit the
  existing grants (precedent: `20260827130000_person_slack_user_id.sql`).
- Always check `error` on `.select()`; FK hints on dual-FK embeds (`team_membership` -> `person`
  is single-FK, so plain `person (...)` embed is fine, as Drive does).
- Server code reads env secrets at call time (`*CredentialsFromEnv()` returning `null` when
  incomplete), never at module load.
- `app_setting` `*_secret` must be set per-env in prod or the pg_cron job silently 403s. Setup
  doc must carry the same warning Drive's does.
- `not_configured` responses return presence booleans only, never values.
- teams.ts must not be imported by the sync libs (cycle).
- Modified Next.js: route files export only HTTP verbs; `params` is a `Promise`; `cookies()` is
  async from `next/headers` (both already followed by the Onshape OAuth routes).

Policy defaults, identical to Drive: reconcile **adds** missing members, **reports**
`wouldRemove`, **never bulk-removes**. The only automatic removal path is the real-time hook on
`removeMember`. Only `person.is_active` people are expected. Same route gate (shared secret
header `x-sync-secret` or mentor+ session), `reportSyncOutcome` to Slack, last report stored in
`app_setting`, nightly pg_cron.

## 2. Chosen approach

### 2.1 One GitHub App does everything (confirmed)

A single GitHub App registered under the `RAR1741` org gives all three credentials we need;
no separate OAuth App and no PAT:

| Purpose | Token | How |
| --- | --- | --- |
| Prove we are the App | App JWT (RS256) | signed with the App private key; `iss` = App ID, `iat` = now-60s, `exp` = now+9min (max 10) |
| Admin ops (list/add/remove team members, list invitations) | Installation access token (1 h) | `POST /app/installations/{installation_id}/access_tokens` with `Authorization: Bearer <jwt>` |
| Identify a member during "Connect GitHub" | User access token (`ghu_…`, 8 h, expiring) | web flow: `https://github.com/login/oauth/authorize?client_id&redirect_uri&state` -> `POST https://github.com/login/oauth/access_token` (`client_id`, `client_secret`, `code`, `redirect_uri`, header `Accept: application/json`) |

The user token is used **once**, transiently in the callback, for `GET /user` (`login`,
`id`). It is never persisted. All ongoing work runs on the installation token, so there is
nothing to refresh and nothing to leak. Leave "Expire user authorization tokens" on (default).

App configuration (documented in `docs/setup/github-app.md`):

- Register under the org. Permissions: **Organization -> Members: Read and write**. Nothing
  else. Repository permissions: none. Webhooks: off.
- Install on the org only ("Only on this account").
- Enable "Request user authorization (OAuth) during installation" is **not** needed; we only
  need the App's OAuth client. Register callback URLs (up to 10): prod
  `https://hub.redalert1741.org/api/github/oauth/callback` and
  `http://localhost:3000/api/github/oauth/callback`.
- Generate a private key (PEM) and a client secret.

Headers on every REST call: `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version: 2022-11-28` (the version all verified endpoint pages were served for; a
newer `2026-03-10` exists and is out of scope), `User-Agent: rar1741-hub` (GitHub 403s
requests without one), `Authorization: Bearer <token>`.

### 2.2 Data model

Migration `supabase/migrations/20260901120000_github_team_sync.sql`:

```sql
-- team <-> GitHub Team link. Null = not linked (same semantics as google_group_email).
alter table team add column if not exists github_team_slug text;

-- Verified GitHub identity, set only by the OAuth callback. id is the stable key
-- (logins can be renamed); login is kept for display and for matching pending invites.
alter table person add column if not exists github_login text;
alter table person add column if not exists github_user_id bigint unique;
-- team and person are already granted to service_role; new columns need no grant.

insert into app_setting (key, value)
values ('github_sync_url', '"http://host.docker.internal:3000/api/admin/github-team/sync"')
on conflict (key) do nothing;
-- github_sync_secret is deliberately NOT seeded: prod must set it or the cron 403s.

select cron.schedule(
  'github-team-nightly-sync',
  '20 7 * * *',   -- 20 min after drive-group-nightly-sync (0 7 * * *); avoids one process doing both at once
  $cron$ select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'github_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'github_sync_secret')),
    body := '{}'::jsonb) $cron$
);
```

Why no `github_connection` table: we store no tokens, so there is nothing to keep beyond two
scalars per person. `person.slack_user_id` is the exact precedent. `github_user_id` is
`unique` (one GitHub account links to one person; a second person connecting the same account
gets a `23505` -> "taken"). `github_login` is **not** unique; the id is the real guard and a
stale login on one row must not block a connect on another.

`merge_people` (20260816) predates `slack_user_id` and does not carry it over; the loser row
is deleted, so no unique collision, and the loser's link is simply lost. Same behavior for
GitHub columns; a follow-up could coalesce both. Deferred, parity with Slack.

Types (`src/lib/types.ts`): `TeamRow.github_team_slug: string | null`,
`Team.githubTeamSlug: string | null`, mapped in `teamFromRow`; `PersonRow.github_login`,
`PersonRow.github_user_id: number | null` (`bigint` arrives as a JS number via PostgREST;
GitHub ids fit comfortably), `Person.githubLogin`, `Person.githubUserId`, mapped in
`personFromRow` next to `slackUserId`.

### 2.3 Module boundaries (new files)

```
src/lib/github-app.ts          sibling of google-auth.ts + the auth half of google-directory.ts
src/lib/github-teams.ts        sibling of the REST half of google-directory.ts
src/lib/github-team-sync.ts    sibling of drive-group-sync.ts
src/lib/membership-sync.ts     tiny dispatcher: fan out add/remove to Drive + GitHub
```

**`github-app.ts`** (auth only, no team knowledge):

```ts
export type GithubAppCredentials = {
  appId: string; privateKey: string; installationId: string; org: string;
  clientId: string; clientSecret: string;
};
export type GithubDeps = { fetch: typeof fetch; credentials: GithubAppCredentials; now?: () => Date };

export function githubAppCredentialsFromEnv(): GithubAppCredentials | null;
// GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (\n restored like GOOGLE_SA_PRIVATE_KEY),
// GITHUB_APP_INSTALLATION_ID, GITHUB_ORG, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET.
// null if any is missing. Presence booleans for not_configured come from a sibling
// `githubAppConfigPresence()` returning { appId, privateKey, installationId, org, clientId, clientSecret }.

export function buildGithubAppJwt(creds, now: Date): string;
// header {alg:"RS256",typ:"JWT"}; claims { iat: now-60, exp: now+540, iss: appId }. createSign("RSA-SHA256"), base64url.

export function fetchInstallationToken(deps: GithubDeps): Promise<string>;
// WeakMap<GithubDeps, Promise<string>> cache exactly like google-directory.tokenCache: one token per reconcile run.

export function githubHeaders(token: string): Record<string, string>;
// Accept, X-GitHub-Api-Version, User-Agent, Authorization: Bearer.
```

Why not reuse `google-auth.ts`: Google's JWT is a jwt-bearer *grant* (claims `scope`, `aud`,
`sub`, 1 h) exchanged at a token endpoint; GitHub's JWT *is* the bearer credential (no
`aud`/`scope`, <= 10 min) and is exchanged at a per-installation endpoint. Only the
`createSign("RSA-SHA256")`/base64url technique repeats, ~10 lines. Sibling, not reuse.
`ponytail:` duplicate the base64url helper rather than exporting it from google-auth.ts; lift
to a shared `jwt-sign.ts` if a third signer appears.

**`github-teams.ts`** (REST wrappers, all installation-token):

```ts
export type GithubUser = { id: number; login: string };

export async function listTeamMembers(deps, slug): Promise<GithubUser[]>;
// GET /orgs/{org}/teams/{slug}/members?per_page=100&page=N until short page. Includes child-team members. Excludes pending invitees.

export async function listPendingTeamInvitations(deps, slug): Promise<string[]>;
// GET /orgs/{org}/teams/{slug}/invitations?per_page=100 -> lowercased `login`s; skip rows with login null (email invites) and rows with failed_at set.

export async function putTeamMembership(deps, slug, username): Promise<{ ok: boolean; status: number; state?: "active" | "pending" }>;
// PUT /orgs/{org}/teams/{slug}/memberships/{username} body {role:"member"}. 200 -> state from body. ok = res.ok.
// Adds directly if already an org member; otherwise creates an org invitation and returns state "pending".

export async function deleteTeamMembership(deps, slug, username): Promise<{ ok: boolean; status: number }>;
// DELETE /orgs/{org}/teams/{slug}/memberships/{username}. ok = res.ok || res.status === 404 (mirror Drive's deleteGroupMember). Keeps org membership.
```

**`github-team-sync.ts`** (the Drive mirror):

```ts
export type GithubTeamReconcileReport = {
  teamName: string; teamSlug: string;
  expectedCount: number; actualCount: number;
  added: string[];        // logins PUT this run that came back state "active"
  pending: string[];      // logins with an outstanding org invitation (pre-existing or created this run)
  wouldRemove: GithubUser[]; // on the GitHub team, not expected; NOT acted on
  notConnected: string[]; // display names of active hub members with no github_user_id
  errors: string[];
};
export type GithubReconcileResult = { ranAt: string; teams: GithubTeamReconcileReport[] };

export function computeGithubTeamDiff(
  expected: GithubUser[], actual: GithubUser[], pendingLogins: string[],
): { missing: GithubUser[]; pending: string[]; extra: GithubUser[] };
// Pure. Key membership on numeric id. missing = expected ids not in actual AND login (lowercased) not in pendingLogins.
// pending = expected logins that ARE in pendingLogins. extra = actual ids not in expected.

export async function reconcileGithubTeams(deps: { db; fetch; credentials; now? }): Promise<GithubReconcileResult>;
export async function syncGithubMembershipChange(action: "add" | "remove", teamId, personId, db): Promise<void>;
export async function syncPersonLinkedTeams(personId, db): Promise<void>;
export function computeGithubAddRecommendations(report, slugToTeam, personByGithubId, membersByTeam): TeamAddRecommendations[];
```

**`membership-sync.ts`**:

```ts
import { syncMembershipChange as drive } from "./drive-group-sync";
import { syncGithubMembershipChange as github } from "./github-team-sync";
export async function syncMembershipChange(action, teamId, personId, db) {
  // allSettled: both hooks are documented never-throw, but a regression in one must not skip the other.
  await Promise.allSettled([drive(action, teamId, personId, db), github(action, teamId, personId, db)]);
}
```

Fan-out decision: `teams.ts` changes **one import line** (`./drive-group-sync` ->
`./membership-sync`); the three call sites (`upsertMember`, `removeMember`, `joinTeam`) are
untouched. Both hooks already never throw. No test or e2e file imports or mocks
`drive-group-sync` other than its own unit test, so the rename is safe. This is smaller and
lower-risk than a second call at three sites.

### 2.4 Reconcile algorithm

Per run (`reconcileGithubTeams`):

1. Get installation token once (WeakMap cache on `deps`).
2. `team.select("id, name, github_team_slug").not("github_team_slug", "is", null)`; check
   `error`.
3. For each linked team:
   a. `team_membership.select("person (id, first_name, last_name, is_active, github_login, github_user_id)").eq("team_id", id)`;
      check `error`. Expected = rows with `is_active` and `github_user_id != null` ->
      `{id, login}`. `notConnected` = active rows with null `github_user_id` -> display name.
   b. `actual = listTeamMembers(slug)`; `pendingLogins = listPendingTeamInvitations(slug)`.
      A failure of either pushes to `errors` and skips the team (as Drive does).
   c. **Login self-heal**: for each actual member whose `id` matches an expected person but
      whose `login` differs (renamed account), `person.update({ github_login })`; log the
      error into `errors`, do not abort.
   d. `computeGithubTeamDiff(expected, actual, pendingLogins)`.
   e. For each `missing`: `putTeamMembership(slug, login)`. `state === "active"` -> `added`;
      `state === "pending"` -> `pending`; `!ok` -> `errors` (`"login: HTTP status"`). A `404`
      here means the stored login no longer exists (renamed after connecting, before ever
      landing on the GitHub team, so step c could not heal it); record it as
      `"login: not found on GitHub; ask them to reconnect"` so the admin knows the fix.
      Optional upgrade (unverified endpoint, see section 5): if `GET /user/{account_id}`
      works with an installation token, re-resolve the login by id, update `person`, retry
      the PUT once.
   f. `wouldRemove = extra`. Never deleted.
4. Upsert `app_setting` key `github_last_reconcile` with the result (`onConflict: "key"`).

Why this shape handles the traps:

- **Pending invitations**: the members listing omits invitees, so a naive diff re-PUTs every
  invitee nightly (harmless but noisy, and it burns the org's daily invitation budget). The
  team-scoped invitations endpoint carries the invitee `login`, so we bucket those as
  `pending` and do not PUT again. It carries **no user id**, hence the login-keyed match for
  this bucket only. Invitations expire after ~7 days, after which the person drops out of
  `pending`, reappears in `missing`, and is re-invited by the next run — desirable.
- **Identity**: diff keys on `id`. Login renames are healed rather than causing a phantom
  add/remove pair.
- **Add/remove semantics**: PUT adds an org member or invites a non-member; DELETE removes
  from the team but not the org. Removal from the org is out of scope (admin does it in
  GitHub).
- **Nested GitHub teams**: the members endpoint includes child-team members, so a linked
  parent team with children shows inflated `wouldRemove`. Document: link leaf teams only.

`syncGithubMembershipChange(action, teamId, personId, db)` (real-time hook): best-effort,
never throws. Returns early if creds are null, the team has no slug, or the person has no
`github_login`. `add` -> PUT; `remove` -> DELETE. Errors are `console.error`-ed only, as Drive.

`syncPersonLinkedTeams(personId, db)`: called at the end of a successful connect. Looks up the
person's active team memberships whose team has a slug and PUTs each. Without it a newly
connected person waits until 07:20 UTC and assumes it is broken.

### 2.5 Connect GitHub (OAuth) flow

Mirrors `src/app/api/onshape/oauth/{start,callback}/route.ts` exactly.

`GET /api/github/oauth/start` (`src/app/api/github/oauth/start/route.ts`):

- Gate: viewer must be `student`+ with `viewer.person`; otherwise redirect `/login`.
- If `githubAppCredentialsFromEnv()` is null -> redirect `clientUrl(request, "/people/{id}?github=error")`.
- `state = crypto.randomUUID()`; cookie `github_oauth_state` (`httpOnly`, `sameSite: "lax"`,
  `secure: NODE_ENV === "production"`, `maxAge: 600`, `path: "/"`). The literal is duplicated
  in both routes because route files may only export verbs (same as Onshape).
- Redirect 307 to `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=…&state=…`
  where `redirect_uri = clientUrl(request, "/api/github/oauth/callback")`. No `scope`
  parameter: GitHub App user tokens have no scopes.
- PKCE: skipped. We are a confidential client with a `state` cookie; GitHub calls PKCE
  "strongly recommended", not required. `ponytail:` add `code_challenge` if GitHub ever
  requires it for Apps.

`GET /api/github/oauth/callback`:

1. Read `code`, `state`, `error` from the query; read and **clear** `github_oauth_state`
   regardless of outcome.
2. Viewer must still be student+ with a person; mismatched/missing state or `error` present ->
   redirect `/people/{id}?github=error`.
3. `POST https://github.com/login/oauth/access_token` (form or JSON body; `Accept:
   application/json`) with `client_id`, `client_secret`, `code`, `redirect_uri` (same derived
   value). Extract `access_token`.
4. `GET https://api.github.com/user` with `Authorization: Bearer <access_token>` and the
   standard headers -> `{ id, login }`. Discard the token.
5. `person.update({ github_login: login, github_user_id: id }).eq("id", viewer.person.id)`.
   On error code `23505` -> redirect `?github=taken`; other error -> `?github=error`.
6. `await syncPersonLinkedTeams(personId, db)` (best-effort).
7. Redirect `clientUrl(request, "/people/{id}?github=connected")`.

`DELETE /api/people/[id]/github` (`src/app/api/people/[id]/github/route.ts`): gate self or
admin (`hasRole(viewer.role, "admin") || viewer.person?.id === id`); sets both columns null;
`204`. Does **not** call GitHub; the person surfaces in `wouldRemove` on the next reconcile,
and an admin removes them from the hub team (which fires the real hook) if that is intended.

Redirect-URI notes:

- Derive via `clientUrl(request, …)`, never `request.url` (container seam).
- GitHub requires an exact match against a registered callback URL. Prod URL plus
  `http://localhost:3000/...` are registered. Per-worktree ports (`3001`, `3002`, …) are
  covered **if** GitHub's loopback rule ("for `http://localhost` / `127.0.0.1` the port need
  not match") applies to GitHub Apps as it does to OAuth Apps — see unverified items. If it
  does not, add an env override `GITHUB_OAUTH_REDIRECT_URI` and register each dev port; the
  code path is one `?? clientUrl(...)`.

Where the Connect button lives: a `GitHubConnectCard` on `/people/[id]`, rendered under the
same `self-or-admin` condition as the FIRST status card but **without** the
`role !== "student"` restriction (students need GitHub most). No `/me` profile page exists.

### 2.6 Sync route, settings, alerts

`POST /api/admin/github-team/sync` (`src/app/api/admin/github-team/sync/route.ts`) is a copy of
the Drive route with names swapped:

- Gate 1: `x-sync-secret` header vs `getSetting("github_sync_secret", "", db)` via
  `secureEqual`; empty stored secret never authorizes. Gate 2: `getViewer()` and
  `hasRole(viewer.role, "mentor")`. Else `401`.
- Credentials null -> `400 { error: "not_configured", have: githubAppConfigPresence() }`.
- Run `reconcileGithubTeams`; `reportSyncOutcome("github_sync", true, { db })`; return the
  result. On throw: log, `reportSyncOutcome("github_sync", false, { db, error })`, `502
  { error: "sync_failed" }`.

`src/lib/slack-alerts.ts`: extend `AlertSource` with `"github_sync"` and `LABELS` with
`github_sync: "GitHub team sync"`.

Settings: `github_sync_url` seeded by migration; `github_sync_secret` set per-env by hand (SQL
snippet in setup doc, same as Drive). The new cron row appears on `/admin/cron` automatically.

### 2.7 Recommendations (reverse flow)

`computeGithubAddRecommendations(report, slugToTeam, personByGithubId, membersByTeam)` mirrors
`computeAddRecommendations`: for each team report, for each `wouldRemove` `{id, login}`, look
up `personByGithubId[id]`; if the person exists, is active, and is **not** already in
`membersByTeam[teamId]` (the load-bearing filter Drive comments on), emit
`{ personId, name, labels: ["@login"] }`. Unknown ids (GitHub users with no hub person) are
skipped; the report already lists them.

Output type is the structural `TeamAddRecommendations` after the component generalization
below. `ponytail:` this is a near-copy of the Drive function keyed on id instead of email;
merge them behind a key-extractor if a third integration appears.

### 2.8 Admin UI

`src/app/admin/github-sync/page.tsx` — copy of `admin/drive-sync/page.tsx`:

- Admin gate (redirect `/` otherwise). Loads `listTeams()`, `getSetting<GithubReconcileResult
  | null>("github_last_reconcile", null)`, `listPeople()`, `getTeamTimezone()`.
- Builds `slugToTeam`, `personByGithubId` (from people with `githubUserId`), `nameByLogin`
  (lowercased) and `membersByTeam` via `team_membership.select("team_id, person_id").in("team_id", ids)`.
- Renders: `SyncNowPanel`, linked-teams table (team, slug, connected count / active count),
  `GithubReconcileReport`, `RecommendedMembers`, plus a "Not connected" summary line per team
  (already in the report component).

Component changes:

- `DriveSyncPanel.tsx` -> rename to `SyncNowPanel.tsx` with props `{ endpoint: string; noun:
  string; countKey: "groups" | "teams" }` (or simply count `Object.values(body).find(Array.isArray)`);
  Drive page passes `/api/admin/drive-group/sync`. Same button, same `router.refresh()`.
- `RecommendedMembers.tsx`: change `people: { personId, name, emails: string[] }` to
  `{ personId, name, labels: string[] }` and add a `description: string` prop replacing the
  hardcoded "People with Drive access…" sentence. `TeamAddRecommendations` in
  `drive-group-sync.ts` renames `emails` -> `labels` (one field; the Drive page reads it in one
  place). Both pages map into it. The "Add all" loop comment updates to "each add triggers the
  Drive/GitHub hooks".
- New `GithubReconcileReport.tsx`: renders `ranAt`, then per team: counts, `Added`, `Pending`,
  `Would remove`, `Not connected`, `Errors`. Logins resolve to names via `nameByLogin`; unknown
  logins render as plain `@login` linking to `https://github.com/{login}`. No associate modal:
  the verification requirement forbids admin-entered links, so `ReconcileReport.tsx` is not
  reused.
- New `GitHubConnectCard.tsx` (server component; the actions are plain links/one small client
  button): if `githubLogin` null and viewing self -> "Connect GitHub" link to
  `/api/github/oauth/start`; if linked -> `@login` (link to GitHub profile) + `Disconnect`
  button (client, `fetch DELETE` then `router.refresh()`), shown to self or admin; admin
  viewing an unlinked other -> "Not connected". Reads `?github=connected|error|taken` from
  `searchParams` for a one-line status message.
- `TeamForm.tsx`: add `githubTeamSlug` field beside `googleGroupEmail` (label "GitHub team
  slug", placeholder `software`). `admin/teams/[id]/page.tsx` passes `initial.githubTeamSlug`.
- `src/lib/teams.ts`: `TeamInput.githubTeamSlug`; `parseTeamInput` uses `optString(b.githubTeamSlug, 100)`,
  then lowercases and rejects anything not matching `/^[a-z0-9][a-z0-9-]*$/`;
  `createTeam`/`updateTeam` write `github_team_slug`.
- `src/app/admin/page.tsx`: `<Card href="/admin/github-sync" icon="users" title="GitHub team sync" hint="…" />`
  next to the Drive card. `SiteNav.tsx` `ADMIN_ITEMS`: `{ label: "GitHub team sync", href: "/admin/github-sync", role: "admin" }`.

### 2.9 Env vars

`.env.example` block after the Onshape block:

```
# GitHub App (team sync + "Connect GitHub"). See docs/setup/github-app.md
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=        # PEM; newlines as \n
GITHUB_APP_INSTALLATION_ID=    # from the App's install page or GET /orgs/{org}/installation
GITHUB_ORG=RAR1741
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
# GITHUB_OAUTH_REDIRECT_URI=   # optional override; default derives from the request origin
```

Installation id is env rather than looked up per run: one fewer JWT call per reconcile, and
it only changes if the App is uninstalled and reinstalled (documented).

### 2.10 Docs

- `docs/features/github-team-sync.md` — what syncs, buckets, policy (add/report/never
  bulk-remove), connect/disconnect behavior, limitations (leaf teams only, invite expiry,
  IdP team sync 403).
- `docs/setup/github-app.md` — create App under org, permission Members R/W, install on org,
  callback URLs, private key + client secret, env vars, `not_configured` note, link teams by
  slug, set `github_sync_secret`/`github_sync_url` per env with the prod warning and SQL
  snippet, manual trigger curl, invitation budget note.
- `docs/features.md` Integrations section — one line in the Drive line's format.
- `docs/features/slack-integration.md` — add `github_sync` to the alert sources list.

## 3. Alternatives considered

- **Separate OAuth App + PAT** (issue's original framing). Rejected: two credentials to
  rotate, PAT tied to a human account, and the GitHub App covers both halves.
- **Admin types the GitHub login** on the person form. Rejected by decision 2; typos and
  impersonation. Also loses the stable id.
- **Persist user tokens** in a `github_connection` table (Onshape pattern). Rejected: no
  ongoing per-user call exists; the installation token does all work. Fewer secrets at rest,
  no refresh logic, no new table/grant.
- **Diff by login only.** Rejected: renames produce a phantom remove+invite and the unique
  guard would be on a mutable value.
- **Org membership sync instead of team sync.** Rejected by decision 1.
- **Second `syncGithubMembershipChange` call at the three teams.ts sites.** Rejected in favor
  of the one-line import swap to a dispatcher; identical behavior, smaller diff.
- **Look up installation id per run via `GET /orgs/{org}/installation`.** Rejected: an env var
  is simpler and the id is effectively static.

## 4. Trade-offs and risks

- **Invitation budget.** New orgs: 50 invitations / 24 h; orgs older than a month or on a
  paid plan: 500. A first bulk sync of a large team of non-org-members could hit the low
  limit. Mitigation is already the design: failures land in `errors`, `pending` stops repeat
  invites, and the next nightly run retries. Setup doc says so.
- **Nested GitHub teams** inflate `wouldRemove` (members endpoint includes children). Not a
  data-loss risk because we never bulk-remove; documented as "link leaf teams".
- **IdP team synchronization** (Enterprise) makes PUT/DELETE return 403. Not our situation;
  surfaced via `errors`.
- **Cookie/redirect on per-worktree ports** depends on the loopback rule (see below). Fallback
  is one env override.
- **Renamed login while an invitation is pending**: pending bucket is login-keyed, so a rename
  mid-invite yields one extra re-invite. Acceptable.
- **`bigint` -> JS number**: PostgREST serializes `bigint` as a JSON number; GitHub ids are far
  below 2^53. Fine.
- **Disconnect does not touch GitHub.** Intentional (Drive parity: the hub never auto-removes
  outside `removeMember`). Documented; admins act on `wouldRemove`.
- **JWT clock skew**: `iat` is set 60 s in the past per GitHub's own recommendation.

## 5. Verification against GitHub docs

Verified from current docs:

- `POST /app/installations/{installation_id}/access_tokens` (JWT bearer; 1 h token).
- JWT claims `iat` (recommend 60 s past), `exp` (max 10 min), `iss` = App ID (or client id);
  RS256.
- Web flow `GET https://github.com/login/oauth/authorize` params `client_id`, `redirect_uri`,
  `state` (+ optional PKCE); `POST https://github.com/login/oauth/access_token` with
  `client_id`, `client_secret`, `code`, `redirect_uri`; `Accept: application/json`; user
  tokens `ghu_`, `expires_in` 28800 when expiring enabled; no scopes.
- `GET /orgs/{org}/teams/{team_slug}/members` (paginated `per_page` max 100; includes child
  team members; excludes pending invitees).
- `GET /orgs/{org}/teams/{team_slug}/invitations` (fields `id`, `login` nullable, `email`,
  `created_at`, `failed_at`, `failed_reason`; no user id).
- `GET|PUT|DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}` (PUT returns `{role,
  state}` with `state: "pending"` when it created an org invitation; 403 when team sync is
  enabled; DELETE 204).
- Organization "Members" permission covers all of the above; installation tokens accepted.
- Callback URL exact-match rule; up to 10 callback URLs per App.
- Organization invitation limits: 50/24 h (new org), 500/24 h (older or paid).

Unverified or inferred — implementer should confirm or code defensively:

1. `GET /user` with a GitHub App **user** access token. The "identifying and authorizing users"
   page says the token is used for API requests on the user's behalf but does not name the
   endpoint; the REST `GET /user` page is marked as working with GitHub Apps. Treated as
   standard; a failing call redirects `?github=error`, so the failure mode is visible.
2. Whether invitations created by team-membership PUT appear under the **team-scoped**
   invitations listing. Docs imply it (`invitation_teams_url`). If they do not, fall back to
   `GET /orgs/{org}/invitations` and filter by `invitation_teams_url`; the wrapper signature
   does not change.
3. DELETE membership on a user who is not on the team: status not documented. We treat
   `204`/`404` as ok.
4. Loopback redirect-URI port leniency is documented on the **OAuth Apps** page; assumed to
   apply to GitHub Apps' user authorization too. Fallback: `GITHUB_OAUTH_REDIRECT_URI`.
5. An "inherited" flag on team member objects was mentioned in one fetch; the members endpoint
   returns simple-user objects, so do not rely on it.
6. `GET /user/{account_id}` (look up a user by numeric id) with an installation token. Only
   needed for the optional stale-login retry in 2.4 step e; skip the retry if it is not
   available.

## 6. Implementation outline (ordered tasks)

Tags: **mechanic** = fully specified above, no local decisions; **coder** = needs local
judgement (API shapes, tests, UI details).

1. **mechanic** — Migration `supabase/migrations/20260901120000_github_team_sync.sql` exactly
   as in 2.2. Run `./dev npm run db:reset` to confirm it applies.
2. **mechanic** — `src/lib/types.ts`: add `github_team_slug` to `TeamRow`, `githubTeamSlug` to
   `Team` + `teamFromRow`; `github_login`/`github_user_id` to `PersonRow`,
   `githubLogin`/`githubUserId` to `Person` + `personFromRow` (next to `slackUserId`).
3. **mechanic** — `src/lib/slack-alerts.ts`: add `"github_sync"` to `AlertSource` and
   `github_sync: "GitHub team sync"` to `LABELS`.
4. **coder** — `src/lib/github-app.ts` per 2.3 (creds from env with `\n` restore, JWT builder,
   WeakMap-cached installation token, `githubHeaders`, `githubAppConfigPresence`). Unit test
   `github-app.test.ts`: JWT header/claims (`iat` = now-60, `exp` = now+540, `iss`), token
   fetched once per deps object (mirror `drive-group-sync.test.ts` RSA-keypair + fake fetch
   setup).
5. **coder** — `src/lib/github-teams.ts` per 2.3: paginated `listTeamMembers`,
   `listPendingTeamInvitations` (skip null-login and failed rows), `putTeamMembership`
   returning `state`, `deleteTeamMembership` with 404-as-ok.
6. **coder** — `src/lib/github-team-sync.ts` per 2.3/2.4/2.7: `computeGithubTeamDiff`,
   `reconcileGithubTeams` (login self-heal, buckets, `github_last_reconcile` upsert),
   `syncGithubMembershipChange`, `syncPersonLinkedTeams`, `computeGithubAddRecommendations`.
   Unit test `github-team-sync.test.ts`: diff keys on id and buckets pending by login; reconcile
   does not PUT a pending login; PUT `state:"pending"` lands in `pending` not `added`; renamed
   login triggers one `person.update`; extra never deleted; hook no-ops without creds/slug/login.
7. **mechanic** — `src/lib/membership-sync.ts` dispatcher per 2.3; change the import in
   `src/lib/teams.ts` line 6 from `./drive-group-sync` to `./membership-sync`. No other edits.
8. **coder** — `src/lib/teams.ts`: `TeamInput.githubTeamSlug`, `parseTeamInput` slug
   validation (lowercase, `/^[a-z0-9][a-z0-9-]*$/`, max 100), write `github_team_slug` in
   `createTeam`/`updateTeam`.
9. **mechanic** — `src/components/TeamForm.tsx`: `githubTeamSlug` field mirroring the
   `googleGroupEmail` field; `src/app/admin/teams/[id]/page.tsx`: pass `initial.githubTeamSlug:
   team.githubTeamSlug ?? ""`.
10. **coder** — OAuth routes `src/app/api/github/oauth/start/route.ts` and
    `.../callback/route.ts` per 2.5 (copy Onshape routes; state cookie `github_oauth_state`;
    `clientUrl`-derived redirect URI; `23505` -> `taken`; `syncPersonLinkedTeams` after
    success). `DELETE src/app/api/people/[id]/github/route.ts` (self-or-admin, null both
    columns).
11. **mechanic** — `src/app/api/admin/github-team/sync/route.ts`: copy of the Drive sync route
    with `github_sync_secret`, `githubAppCredentialsFromEnv`/`githubAppConfigPresence`,
    `reconcileGithubTeams`, `reportSyncOutcome("github_sync", …)`.
12. **coder** — Component generalization: rename `DriveSyncPanel.tsx` -> `SyncNowPanel.tsx`
    with `endpoint`/`noun` props (update the Drive page import); `RecommendedMembers.tsx`
    `emails` -> `labels` + `description` prop; rename the field in `TeamAddRecommendations`
    and the one Drive-page/`computeAddRecommendations` site that builds it; Drive page passes
    `description="People with Drive access who are active but not on the team."`; update the
    `computeAddRecommendations` assertions in `src/lib/drive-group-sync.test.ts` for the
    renamed field.
13. **coder** — `src/components/GithubReconcileReport.tsx` and
    `src/components/GitHubConnectCard.tsx` per 2.8; mount the card in
    `src/app/people/[id]/page.tsx` under the self-or-admin condition (no role restriction);
    read `searchParams.github` for the status line. Reachability check: confirm
    `canViewProfile` (`src/lib/people.ts`) allows a student to view their own profile and that
    `SiteNav.tsx` exposes a link to `/people/{self}`; if there is no such link, add a
    "My profile" nav item for student+ so the Connect button is reachable by the people who
    need it most.
14. **coder** — `src/app/admin/github-sync/page.tsx` per 2.8.
15. **mechanic** — `src/app/admin/page.tsx` card and `src/components/SiteNav.tsx` `ADMIN_ITEMS`
    entry per 2.8.
16. **mechanic** — `.env.example` block per 2.9; docs per 2.10 (`docs/features/github-team-sync.md`,
    `docs/setup/github-app.md`, `docs/features.md` Integrations line,
    `docs/features/slack-integration.md` alert source).
17. **coder** — Verify: `./dev npm run lint`, `typecheck`, `test`, `e2e`; in-browser check of
    `/admin/github-sync` (`not_configured` path without env), team form slug field, and the
    Connect card render states on `/people/[id]`. The live OAuth round-trip and a real reconcile
    need the App registered (setup doc) and are verified by the user against the org.
18. **mechanic** — `graphify update .` after code lands.
