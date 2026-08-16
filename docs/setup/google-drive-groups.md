# Setting up Google Drive group sync

Teams keep membership current in Google Workspace Groups — each linked team's roster mirrors into
a Google Group, so Shared Drives, mailing lists, and anything else scoped to that group stay in
sync automatically. The **code is already wired** — you only enable an API, grant the existing
service account a new delegated scope, and paste a couple of values into config.

## What it does

A nightly pg_cron job (`drive-group-nightly-sync`, `0 7 * * *` — 07:00 UTC) `POST`s
`/api/admin/drive-group/sync`. The same route backs the **Sync now** button on
**Admin → Drive Sync**. For every team with a `google_group_email` set, it:

- reads the team's active, emailed members,
- **adds** anyone missing from the Google Group (idempotent — already-a-member responses count as
  success), and
- **reports** anyone in the Google Group who is no longer expected, without removing them.

Reconcile never deletes a Google Group member on its own. The "would remove" list on
**Admin → Drive Sync** is a report for a human to review — nobody is auto-removed. Real-time
membership changes (someone joining or leaving a team in the app) add or remove the corresponding
Google Group member immediately; it's only the nightly reconcile's *removal* side that is
report-only, to guard against acting on stale or bad data unattended overnight. People without an
email are skipped entirely — there's nothing to add to the group for them.

## 1. Enable the Admin SDK API

In [Google Cloud Console](https://console.cloud.google.com/), use the **same project** as the
existing calendar sync setup (`docs/setup/google-calendar.md`) — no new project or service account
needed.

1. **APIs & Services → Enable APIs & services** → search **Admin SDK API** → **Enable**.

That's it for the Cloud Console side; the service account itself already exists from the calendar
setup.

## 2. Configure domain-wide delegation in Workspace Admin

The Directory API call that lists/adds/removes group members runs as a **domain-wide delegated**
credential — the service account impersonates a real Workspace admin, because the Directory API
doesn't accept plain service-account auth for group membership. Grant **exactly** the one scope
needed, nothing broader:

1. In the [Google Cloud Console service account page](https://console.cloud.google.com/iam-admin/serviceaccounts),
   open the same service account used for calendar sync (e.g. `team-hub-calendar-sync@...`) and
   copy its **Client ID** (the numeric OAuth2 client ID, not the email).
2. In the [Google Workspace Admin console](https://admin.google.com/) → **Security → Access and
   data control → API controls → Domain-wide delegation** → **Add new**.
3. **Client ID:** paste the numeric client ID from step 1.
4. **OAuth scopes:** enter exactly:
   ```
   https://www.googleapis.com/auth/admin.directory.group.member
   ```
   Only this scope — it's the minimum the Directory API requires to list, add, and remove group
   members, and nothing else. Don't add the broader `admin.directory.group` or any other Admin SDK
   scope.
5. **Authorize.**

## 3. Set the impersonated admin subject

Domain-wide delegation requires a real user for the service account to act as — pick a Workspace
admin account with Groups management privileges. This is a new env var alongside the calendar
sync's existing service-account credentials:

```bash
# .env.local
GOOGLE_SA_CLIENT_EMAIL=team-hub-calendar-sync@your-project.iam.gserviceaccount.com
GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
GOOGLE_ADMIN_SUBJECT=admin@your-domain.org
```

`GOOGLE_SA_CLIENT_EMAIL` and `GOOGLE_SA_PRIVATE_KEY` are the same values already set up for
calendar sync (see `docs/setup/google-calendar.md` for the private-key formatting note — literal
`\n` escapes on one line work the same way here). `GOOGLE_ADMIN_SUBJECT` is new: it must be the
email of a Workspace admin who has permission to manage Groups, since that's whose authority the
service account borrows for every Directory API call. If any of the three are missing, the sync
route returns `400 { "error": "not_configured", "have": { clientEmail, privateKey, adminSubject } }`
— booleans only, never the values, so a misconfigured env is diagnosable without leaking secrets.

## 4. Link each team to a Google Group

On a team's edit page (**Admin → Teams → *team* → Edit**, `/admin/teams/[id]`), set the **Google
Group email** field to the Workspace group this team's membership should mirror into. Leaving it
blank disables sync for that team — it's simply skipped by the reconcile job and by real-time
membership hooks.

For initial setup, link the two top-level teams:

| Team | Google Group email |
|---|---|
| FRC Mentor | `mentors@your-domain.org` (the "FRC Mentors" group) |
| FRC Student | `students@your-domain.org` (the "FRC Students" group) |

Add more teams the same way whenever a Shared Drive or mailing list needs to track a sub-team's
roster — no code changes required, just set the field.

## 5. Set the shared secret and production sync URL

Like the calendar sync's `gcal_sync_secret`, the drive-group sync route is dual-gated: it accepts
either a mentor+ session, **or** a request carrying the header `x-sync-secret` matching the
`drive_sync_secret` app setting. This lets the nightly pg_cron job call the route without a
browser session. An empty `drive_sync_secret` authorizes no one via that path — only the mentor+
session gate (and the "Sync now" button) works until you set it.

Generate a random string with `openssl rand -hex 32`. pg_cron's `drive-group-nightly-sync` job
sends this same value as the `x-sync-secret` header.

**Local dev** (in the container):

```bash
./dev npm run db:psql -- -c "insert into app_setting (key, value) values ('drive_sync_secret', '\"<a-long-random-string>\"') on conflict (key) do update set value = excluded.value;"
```

**Production** — the migration does **not** seed `drive_sync_secret` (an unset secret authorizes
no one via the header path), so you must insert it in the production database yourself, the same
way you set `gcal_sync_secret`. Run against prod (Supabase SQL editor or `psql`):

```sql
insert into app_setting (key, value) values ('drive_sync_secret', '"<a-long-random-string>"')
  on conflict (key) do update set value = excluded.value;
```

> If `drive_sync_secret` is missing or empty, the header (`x-sync-secret`) path can never
> authorize, so a `curl` call — and the nightly pg_cron job — get `403 { "error": "forbidden" }`.
> The **Sync now** button still works, because it authorizes off your admin session, not the secret.

The nightly cron migration (`supabase/migrations/20260815200000_drive_group_sync.sql`) seeds
`drive_sync_url` with the **local** dev host, `http://host.docker.internal:3000/api/admin/drive-group/sync`,
so nightly reconcile works out of the box in the dev container. In production this must be updated
to the real app domain — the same pattern `docs/setup/deploy.md` §2 uses for the calendar sync's
`sync_url`:

```sql
update app_setting set value = '"https://<app-domain>/api/admin/drive-group/sync"'
  where key = 'drive_sync_url';
```

Do this as part of the production deploy runbook, alongside setting `gcal_sync_secret` /
`sync_url` for the calendar job — both are data changes read at cron run time, not new migrations.

## 6. Trigger a sync manually

Once `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_ADMIN_SUBJECT`, and at least one
team's Google Group email are all set:

```bash
curl -X POST http://localhost:3000/api/admin/drive-group/sync \
  -H "x-sync-secret: <your drive_sync_secret>"
```

or, signed in as an admin in the browser, use the **Sync now** button on **Admin → Drive Sync**
(`/admin/drive-sync`), which calls the same route from an authenticated session. That page also
shows, per linked team, the expected member count, who was added, and who **would be removed** —
review that list before deciding whether to remove anyone from the Google Group by hand.

## Local vs credential-gated

Team membership editing and the sync engine's logic (`src/lib/drive-group-sync.ts`,
`src/lib/drive-group-sync.test.ts`) are fully unit-tested with injected fake `fetch` and fake db —
the reconcile/add/report logic is verified without any external credentials. The real Google
Directory API round-trip described here is **credential-gated on you**, the same way
`docs/setup/google-calendar.md` and `docs/setup/google-oauth.md` are: it needs domain-wide
delegation granted in a real Workspace Admin console, which can't be done autonomously.
