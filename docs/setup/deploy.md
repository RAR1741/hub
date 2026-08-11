# Deploying Team Hub to production

**The production deploy is performed by you (the team) following this runbook. Claude does NOT run
any deploy step, and the Vercel MCP tools are not used. Every command here you run yourself.**

This mirrors the credential-gated precedent set by `docs/setup/google-oauth.md` and
`docs/setup/google-calendar.md`: the code and migrations are already wired, but creating hosted
accounts, registering OAuth clients, and provisioning infrastructure needs a human with access to
those accounts.

## Overview

1. Create the hosted Supabase project, push migrations.
2. Enable `pg_cron` + `pg_net`, point the calendar-sync cron at the production URL.
3. Create the Vercel project, set env vars, deploy.
4. Register production Google OAuth (mentor sign-in).
5. Smoke-test the deployed app.

## 1. Supabase hosted project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Pick a region close
   to the team; note the project ref (`<project-ref>`) and database password.
2. From the dev container (or any machine with the Supabase CLI), link the repo to the new project
   and push every migration:

   ```bash
   ./dev npx supabase link --project-ref <project-ref>
   ./dev npx supabase db push
   ```

   This applies every migration under `supabase/migrations/` in order, **including
   `20260811101553_service_role_grants.sql`**. That migration re-grants table/sequence/routine
   privileges (and default privileges for future tables) to `service_role` — call this out
   explicitly because it's the reason a freshly-provisioned hosted database works at all: every
   table in this app has RLS enabled with **zero policies**, so all access goes through `getDb()`
   (the service-role client, which has `BYPASSRLS`). `BYPASSRLS` skips row policies but not
   table-level `GRANT`s, and without the grants migration a fresh database would leave
   `service_role` with no table privileges — every query would fail with `42501 permission denied`.
   Because that migration runs last and re-establishes the grants unconditionally, a `db push`
   against a brand-new project just works with no manual `GRANT` step.
3. RLS-zero-policy tables mean there is **no client-side (anon/authenticated) data path at all** —
   `anon`/`authenticated` get nothing. Every read and write in the app goes through server code
   using the service-role key. This is intentional and unchanged in production.

## 2. Enable `pg_cron` + `pg_net`, set the production sync URL

The hourly Google Calendar sync (migration `20260811084653_calendar_cron.sql`) needs the `pg_cron`
and `pg_net` extensions, which aren't always available immediately on a fresh project.

1. **Dashboard → Database → Extensions** → enable `pg_cron` and `pg_net` if not already on.
2. If the extensions were unavailable when `db push` ran the cron migration (mirroring the
   "tolerated if unavailable" handling from local `db:reset` in Task 6), re-run just that migration
   once the extensions are enabled:

   ```bash
   ./dev npx supabase migration up --include-all
   ```

   (or re-apply `20260811084653_calendar_cron.sql` directly via **SQL Editor** if the CLI reports it
   as already-applied but the cron job never got scheduled.)
3. Point the cron job at the **production** sync URL and set a real shared secret — both are read by
   the cron command via sub-selects at run time (see the migration), so this is a data change, not a
   new migration:

   ```sql
   update app_setting set value = '"https://<app-domain>/api/admin/calendar/sync"'
     where key = 'sync_url';
   update app_setting set value = '"<a-long-random-string>"'
     where key = 'gcal_sync_secret';
   ```

   Generate the secret with `openssl rand -hex 32`. This must be the **same value** pg_cron sends as
   the `x-sync-secret` header — the sync route's dual gate accepts either a mentor+ session or a
   request whose `x-sync-secret` header matches this setting. An empty `gcal_sync_secret` (the
   seeded default) authorizes no one, so this step is required before the cron job can actually
   trigger a sync. Full calendar wiring (service account, calendar share, `GOOGLE_SA_*` env vars) is
   covered in `docs/setup/google-calendar.md` — do that first if you haven't.

## 3. Vercel project

1. [vercel.com](https://vercel.com/) → **Add New → Project** → import this repo.
2. Framework preset: **Next.js** (auto-detected). No build command overrides needed.
3. Don't deploy yet — set the environment variables below first (Vercel lets you configure env vars
   before the first deploy, or you can redeploy after setting them).

## 4. Full env-var reference

Set these in **Vercel → Project → Settings → Environment Variables** (Production environment).

### Public (safe to expose to the browser — `NEXT_PUBLIC_*`)

| Variable | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | The hosted project's API URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | The hosted project's anon key (Dashboard → Settings → API). |

### Secret (server-only — never exposed to the browser)

| Variable | Example | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | The hosted project's service-role key. `getDb()` uses this for every server-side query. Guard it like a database password. |
| `STUDENT_SESSION_SECRET` | (32+ random bytes) | Generate with `openssl rand -hex 32`. Signs the student app-JWT cookie. Rotating it logs out all signed-in students. |
| `GOOGLE_OAUTH_CLIENT_ID` | `274...apps.googleusercontent.com` | Production OAuth client id — see §5 below. Set in the hosted Supabase dashboard, not Vercel (see note). |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `GOCSPX-...` | Production OAuth client secret — same note. |
| `GOOGLE_SA_CLIENT_EMAIL` | `team-hub-calendar-sync@....iam.gserviceaccount.com` | Calendar service account, per `docs/setup/google-calendar.md`. |
| `GOOGLE_SA_PRIVATE_KEY` | `"-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"` | Same service account. Paste with literal `\n` escapes on one line, exactly as `docs/setup/google-calendar.md` describes — `gcalCredentialsFromEnv` restores real newlines before parsing the PEM. |

### Config (not secret, but must be exact)

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_INTERNAL_URL` | **leave unset** | Only the dev container needs this (it reaches sibling Supabase containers over `host.docker.internal`). In production, `serverSupabaseUrl()` (`src/lib/supabase-url.ts`) falls back to `NEXT_PUBLIC_SUPABASE_URL` when this is unset — do not set it on Vercel. |

> **`AUTH_COOKIE_NAME` is NOT an environment variable.** The auth cookie name is a hardcoded source constant, `export const AUTH_COOKIE_NAME = "sb-teamhub-auth-token"` in `src/lib/supabase-cookie.ts` — nothing reads `process.env.AUTH_COOKIE_NAME`. Setting it on Vercel has no effect. All Supabase auth clients (browser, middleware, server) import that single constant, so they already agree; if you ever need to change the cookie name, edit the constant in source and redeploy — do not add it as an env var.

### Not environment variables — `app_setting` rows

| Key | Where set | Notes |
|---|---|---|
| `gcal_calendar_id` | Admin → Settings (in-app) | The Google Calendar ID to sync from. |
| `gcal_sync_secret` | SQL (§2 above) | Shared secret pg_cron sends as `x-sync-secret`. |
| `sync_url` | SQL (§2 above) | The production sync endpoint URL, read by the cron job at run time. |

**Where GOOGLE_OAUTH_CLIENT_ID/SECRET actually live:** unlike the other secrets above, these are
**not** consumed by the Next.js app directly — they configure Supabase Auth's Google provider. In
local dev they're read by the Supabase CLI from `.env` via `config.toml`'s `env()` substitution
(see `docs/setup/google-oauth.md`). The hosted project has no `config.toml` to read from, so you set
them directly in **Supabase Dashboard → Authentication → Providers → Google** instead (§5 below).
They're listed in the table above for completeness/reference, not because they belong in Vercel.

## 5. Production Google OAuth

Contrast with the local flow in `docs/setup/google-oauth.md` (which uses `config.toml` and the local
Supabase Auth callback at `127.0.0.1:54321`). In production:

1. In the same Google Cloud project used for local OAuth (or a new one), either add a redirect URI
   to the existing OAuth client or create a second client for production
   (**APIs & Services → Credentials**).
2. **Authorized redirect URI** — register the **hosted Supabase project's** auth callback, exactly:
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
   (This is the Supabase callback, not the app's — same rule as local, per
   `docs/setup/google-oauth.md`'s "#1 thing people get wrong".)
3. **Supabase Dashboard → Authentication → Providers → Google** — enable it, paste the client ID and
   secret.
4. **Supabase Dashboard → Authentication → URL Configuration** — set:
   - **Site URL:** `https://<app-domain>`
   - **Redirect URLs (additional):** `https://<app-domain>/auth/callback`
5. If the OAuth consent screen is still in **Testing** mode, add each mentor's Google account as a
   test user, or publish the app (allowed without review since only non-sensitive scopes are used —
   see `docs/setup/google-oauth.md`).
6. **The first person to sign in with Google on the production deployment becomes admin** (the same
   bootstrap rule as local — `decideOAuthLink` promotes the first Google sign-in when there are zero
   admins). Sign in yourself first, then add mentor `person` rows in Admin → People using the Google
   email each mentor will use.

## 6. Rate-limit real client IP

`src/lib/rate-limit.ts`'s `clientIp` now prefers the `x-real-ip` header over the first hop of
`x-forwarded-for`:

```ts
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}
```

On Vercel, `x-real-ip` is set by the trusted edge proxy to the true client IP and cannot be spoofed
by the client — unlike `x-forwarded-for`, whose first hop a client can forge by sending its own
`X-Forwarded-For` header. **No extra configuration is needed on Vercel.** This affects the two
public, unauthenticated rate limiters (`studentLoginLimiter`, `accountRequestLimiter`) used by the
student login and account-request endpoints.

If you ever deploy behind a different reverse proxy or CDN (not Vercel), verify which header that
platform sets and trusts before relying on this — `x-real-ip` is a de-facto convention, not a
universal standard, and an untrusted proxy in front of the app could forge it same as
`x-forwarded-for`.

## 7. CI

CI (`.github/workflows/ci.yml`) runs on every push to `master` and every pull request:
- `checks` job: lint, typecheck, unit tests (`npm run test`).
- `e2e` job: spins up local Supabase, builds and starts the app, installs headless Chromium, and
  runs the Playwright smoke suite (`npm run e2e`) covering kiosk sign-in/out, guest read-only
  access, student-ID login, and mentor session editing (Task 11).

Both jobs are green on `master`. A production deploy should only proceed from a commit where CI is
green — check the Actions tab (or `gh run watch --exit-status`) before deploying.

## 8. Post-deploy smoke test

Once the Vercel deploy is live and DNS/domain is attached:

1. Visit `https://<app-domain>/login` → **Mentor sign in with Google** → confirm you land signed in
   as admin (first sign-in bootstrap, §5).
2. **Admin → Periods** → create an attendance period.
3. **Admin → Kiosk Devices** → register a kiosk device; open `/kiosk` on that device and confirm
   sign-in/out works.
4. Finish `docs/setup/google-calendar.md` (service account + calendar share) if not already done,
   then trigger a manual sync:
   ```bash
   curl -X POST https://<app-domain>/api/admin/calendar/sync \
     -H "x-sync-secret: <your gcal_sync_secret>"
   ```
   Confirm it returns `{ "meetings": <n>, "buildDays": <n> }`.
5. Visit `/calendar` and confirm the attendance grid renders with build days from the sync.

## Known follow-ups

- **Local Playwright Chromium isn't baked into the devcontainer image.** `npx playwright install
  chromium` installs into the container's writable layer, so a devcontainer rebuild (not just a
  restart) loses it and `./dev npx playwright install chromium` needs to be re-run before `npm run
  e2e` works locally again. CI is unaffected (it installs Chromium fresh every run). Consider adding
  the install to the devcontainer's `Dockerfile`/`postCreateCommand` later so it survives rebuilds.
- The real Google Calendar round-trip, production Google OAuth, and this deploy itself are all
  credential/account-gated on the team — nothing here can be verified without a human completing the
  account-creation steps above, the same posture as `docs/setup/google-oauth.md` and
  `docs/setup/google-calendar.md`.
