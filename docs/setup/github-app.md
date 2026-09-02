# Setting up GitHub App for team sync

Teams keep membership current in GitHub Teams within the org — each linked team's roster mirrors into
a GitHub Team, so anything scoped to that team stays in sync automatically. The **code is already wired**
— you only register a GitHub App, grant the existing installation the right permissions, and paste a couple
of values into config.

## What it does

A nightly pg_cron job (`github-team-nightly-sync`, `20 7 * * *` — 07:20 UTC, 20 min after the Drive sync)
`POST`s `/api/admin/github-team/sync`. The same route backs the **Sync now** button on
**Admin → GitHub team sync**. For every team with a `github_team_slug` set, it:

- reads the team's active members with verified GitHub identity,
- **adds** anyone missing from the GitHub Team (idempotent — already-a-member responses count as success;
  non-org-members are invited as new org members), and
- **reports** anyone on the GitHub Team who is no longer expected, without removing them.

Reconcile never deletes a GitHub Team member on its own. The "would remove" list on
**Admin → GitHub team sync** is a report for a human to review — nobody is auto-removed. Real-time
membership changes (someone joining or leaving a team in the app) add or remove the corresponding
GitHub Team member immediately; it's only the nightly reconcile's *removal* side that is
report-only, to guard against acting on stale or bad data unattended overnight. People without a
verified GitHub identity are skipped entirely — there's nothing to add to the GitHub Team for them.

## 1. Register a GitHub App under the org

In [github.com/orgs/RAR1741/settings/apps](https://github.com/orgs/RAR1741/settings/apps), create a
new GitHub App (top-right **New GitHub App** button). Configure:

1. **App name:** `team-hub-github-sync` (or similar; this is an internal label).
2. **Homepage URL:** `https://hub.redalert1741.org` (or the production hub URL).
3. **Webhook:** toggle **Active** off (we don't need webhooks).
4. **Permissions**: under **Repository permissions** and **Organization permissions**, set only:
   - **Organization → Members**: Read and write
   - No repository permissions.
5. **Where can this GitHub App be installed?** Check **Only on this account** (installs only to RAR1741 org).
6. **User authorization (OAuth)**: leave unchecked (we don't need users to authorize the App during
   installation; the App itself is the credential).

Create the app. You'll be redirected to the app's settings page.

## 2. Register OAuth callback URLs

On the app's settings page, under **Client credentials**, you'll see the **Client ID**. Scroll down to
**Identifying and authorizing users** → **Authorization callback URL**. Register the callback URLs for
the OAuth flow that links people's GitHub accounts:

- Production: `https://hub.redalert1741.org/api/github/oauth/callback`
- Local dev: `http://localhost:3000/api/github/oauth/callback`

Save changes.

## 3. Generate credentials

On the app's settings page:

1. Under **Client credentials**, copy the **Client ID** and paste it into the `GITHUB_APP_CLIENT_ID` env var.
2. Under **Client credentials**, click **Generate a new client secret**, then copy and paste it into
   `GITHUB_APP_CLIENT_SECRET`.
3. Under **Private keys**, click **Generate a private key**. GitHub downloads a `.pem` file. Open it in
   a text editor, copy the entire contents (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`),
   and paste it into `.env.local` as:
   ```
   GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
   ```
   Replace actual newlines with literal `\n` on a single line (same format as `GOOGLE_SA_PRIVATE_KEY`).

## 4. Find the app's ID and installation ID

On the app's settings page, at the very top under "About", you'll see **App ID**. Copy it and paste it
into `GITHUB_APP_ID`.

For the **Installation ID**, go to [github.com/orgs/RAR1741/settings/installations](https://github.com/orgs/RAR1741/settings/installations),
click the app you just created, and look at the URL — it will be
`https://github.com/orgs/RAR1741/settings/installations/{installation_id}`. Copy that number and paste
it into `GITHUB_APP_INSTALLATION_ID`.

Alternatively, if you have the GitHub CLI installed, run:
```bash
gh api orgs/RAR1741/installation | jq '.id'
```

## 5. Fill the remaining env vars

In `.env.local` (or the environment you're setting up):

```bash
GITHUB_APP_ID=<from step 4>
GITHUB_APP_PRIVATE_KEY=<from step 3>
GITHUB_APP_INSTALLATION_ID=<from step 4>
GITHUB_ORG=RAR1741
GITHUB_APP_CLIENT_ID=<from step 3>
GITHUB_APP_CLIENT_SECRET=<from step 3>
```

If `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, or `GITHUB_APP_PRIVATE_KEY` are missing, the
OAuth callback route returns `400 { "error": "not_configured", "have": { ... } }` (booleans only, never
the values, so a misconfigured env is diagnosable without leaking secrets). Similarly, if any credential
is missing for the sync route, it returns `400 { "error": "not_configured", "have": { ... } }`.

## 6. Link teams by slug

On a team's edit page (**Admin → Teams → *team* → Edit**, `/admin/teams/[id]`), set the **GitHub team slug**
field to the slug of the GitHub Team within RAR1741 that this team's membership should mirror into. Leaving
it blank disables sync for that team — it's simply skipped by the reconcile job and by real-time membership
hooks.

Team slugs are lowercase, hyphen-separated, and visible in the GitHub org's Teams page URL. For example,
the "Software Team" GitHub team has slug `software`.

## 7. Set the shared secret and production sync URL

Like the Drive-group sync's `drive_sync_secret`, the GitHub team sync route is dual-gated: it accepts
either a mentor+ session, **or** a request carrying the header `x-sync-secret` matching the
`github_sync_secret` app setting. This lets the nightly pg_cron job call the route without a browser
session. An empty `github_sync_secret` authorizes no one via that path — only the mentor+ session gate
(and the "Sync now" button) works until you set it.

Generate a random string with `openssl rand -hex 32`. pg_cron's `github-team-nightly-sync` job sends this
same value as the `x-sync-secret` header.

**Local dev** (in the container):

```bash
./dev npm run db:psql -- -c "insert into app_setting (key, value) values ('github_sync_secret', '\"<a-long-random-string>\"') on conflict (key) do update set value = excluded.value;"
```

**Production** — the migration does **not** seed `github_sync_secret` (an unset secret authorizes
no one via the header path), so you must insert it in the production database yourself. Run against prod
(Supabase SQL editor or `psql`):

```sql
insert into app_setting (key, value) values ('github_sync_secret', '"<a-long-random-string>"')
  on conflict (key) do update set value = excluded.value;
```

> **IMPORTANT: If `github_sync_secret` is missing or empty, the header (`x-sync-secret`) path can never
> authorize, so a `curl` call — and the nightly pg_cron job — get `403 { "error": "forbidden" }`.
> The **Sync now** button still works, because it authorizes off your admin session, not the secret.**

The nightly cron migration seeds `github_sync_url` with the **local** dev host,
`http://host.docker.internal:3000/api/admin/github-team/sync`, so nightly reconcile works out of the box
in the dev container. In production this must be updated to the real app domain:

```sql
update app_setting set value = '"https://<app-domain>/api/admin/github-team/sync"'
  where key = 'github_sync_url';
```

Do this as part of the production deploy runbook, alongside setting `github_sync_secret` and any other
sync secrets — both are data changes read at cron run time, not new migrations.

## 8. Trigger a sync manually

Once all env vars are set and at least one team's GitHub team slug is configured:

```bash
curl -X POST http://localhost:3000/api/admin/github-team/sync \
  -H "x-sync-secret: <your github_sync_secret>"
```

or, signed in as an admin in the browser, use the **Sync now** button on **Admin → GitHub team sync**
(`/admin/github-sync`), which calls the same route from an authenticated session. That page also
shows, per linked team, the expected member count, who was added, who is pending an org invite, and who
**would be removed** — review that list before deciding whether to remove anyone from the GitHub Team by hand.

## Organization invitation budget

New GitHub orgs have a rate limit of 50 org invitations per 24 hours; orgs older than a month or on a paid
plan have 500 per 24 hours. A first bulk sync of a large team of non-org-members could hit the low limit.
Mitigation is already built into the design:

- Failures land in the `errors` report.
- Pending invites are tracked and not re-invited, avoiding redundant budget burn.
- The next nightly run retries failed invites.

The setup doc lists the invitation budget as informational; it's not a blocker, just something to be aware
of if a bulk invite fails.

## Local vs credential-gated

Team membership editing and the sync engine's logic (`src/lib/github-team-sync.ts`,
`src/lib/github-team-sync.test.ts`) are fully unit-tested with injected fake `fetch` and fake db —
the reconcile/add/report logic is verified without any external credentials. The real GitHub App API
round-trip described here is **credential-gated on you**, the same way `docs/setup/slack.md` and
`docs/setup/google-oauth.md` are: it needs real app registration on the GitHub org, which can't be done autonomously.
