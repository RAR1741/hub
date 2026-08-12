# Setting up Google Calendar sync

The team plans build days on a Google Calendar. This guide wires that calendar into Team Hub so
build days show up automatically. The **code is already wired** — you only create a service account
in Google, share the calendar with it, and paste a few values into config.

## What it does

An hourly pg_cron job (Task 6) `POST`s `/api/admin/calendar/sync`. The route exchanges a
service-account credential for a read-only OAuth token, pulls events off one Google Calendar, and:

- upserts each event into `meeting` (matched by `gcal_event_id`, so re-syncing just updates the
  same rows), and
- marks each meeting's **local start date** as a `build_day`, defaulting to `kind = 'required'`
  and `source = 'gcal'`.

Sync **never overwrites an existing `build_day` row** — if an admin already set that date manually
(Task 4, `source = 'manual'`) or flipped it to `optional`, the sync leaves it alone. This means the
app is fully usable (attendance, build days, everything) before the calendar is ever connected —
connecting Google Calendar is a convenience, not a dependency.

## 1. Create a service account

In [Google Cloud Console](https://console.cloud.google.com/), use the **same project** as the OAuth
sign-in setup (`docs/setup/google-oauth.md`).

1. **APIs & Services → Enable APIs & services** → search **Google Calendar API** → **Enable**.
2. **APIs & Services → Credentials → Create credentials → Service account.**
   - Name it something like `team-hub-calendar-sync`. No roles/permissions needed at the project
     level — access is granted per-calendar in step 2.
3. Open the new service account → **Keys → Add key → Create new key → JSON** → download it.
   The JSON contains `client_email` and `private_key` — that's all you need from it.

## 2. Share the calendar with the service account

1. In Google Calendar, open **Settings** for the team's build-day calendar (not your personal
   calendar — a dedicated team calendar is easiest).
2. **Share with specific people or groups → Add people** → paste the service account's
   `client_email` → permission **See all event details** (read-only; the sync never writes to
   Google).
3. Still in that calendar's settings, under **Integrate calendar**, copy the **Calendar ID**
   (looks like `abc123...@group.calendar.google.com`, or your own email if you shared your primary
   calendar).

## 3. Where the values live

| Variable | File | Read by |
|---|---|---|
| `GOOGLE_SA_CLIENT_EMAIL` | `.env.local` | the Next.js app (sync route) |
| `GOOGLE_SA_PRIVATE_KEY` | `.env.local` | the Next.js app (RS256 assertion) |
| `GOOGLE_CALENDAR_ID` | `.env.local` (optional) | the sync route — **overrides** the `gcal_calendar_id` app setting when set |
| `gcal_calendar_id` | `app_setting` (Admin → Settings) | the sync route — used when `GOOGLE_CALENDAR_ID` is unset |
| `gcal_sync_secret` | `app_setting` (set via SQL / deploy runbook) | the sync route's shared-secret gate + pg_cron |

```bash
# .env.local
GOOGLE_SA_CLIENT_EMAIL=team-hub-calendar-sync@your-project.iam.gserviceaccount.com
GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com   # optional; else set gcal_calendar_id in Admin → Settings
```

The private key from the downloaded JSON spans multiple lines. Two ways to store it:
- **Literal `\n` escapes on one line** (as above) — the code (`gcalCredentialsFromEnv`) restores
  real newlines before parsing the PEM. This is the easiest way to paste a multi-line key into a
  single-line `.env` entry.
- Or keep the real newlines, with the whole value quoted — works too, as long as your `.env`
  loader preserves them.

The calendar id can be provided **either** as the `GOOGLE_CALENDAR_ID` env var in `.env.local`
(simplest — keeps all Google config in one place) **or** as the `gcal_calendar_id` row in
`app_setting`, set from **Admin → Settings** in the app. When both are present the env var wins.
`gcal_sync_secret` is set directly via SQL (see below) since it's only consumed by the sync route
and pg_cron, never shown in the UI.

## 4. Set the shared secret (for pg_cron)

The sync route is dual-gated: it accepts either a mentor+ session, **or** a request carrying the
header `x-sync-secret` matching the `gcal_sync_secret` app setting. This lets the hourly pg_cron job
(Task 6) call the route without a browser session. An **empty** `gcal_sync_secret` (the seeded
default) authorizes no one via that path — only the mentor+ session gate works until you set it.

```bash
./dev npm run db:psql -- -c "update app_setting set value = '\"<a-long-random-string>\"' where key='gcal_sync_secret';"
```

Generate a random string with, e.g., `openssl rand -hex 32`. pg_cron's job (Task 6) sends this same
value as the `x-sync-secret` header.

## 5. Trigger a sync manually

Once `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, and `gcal_calendar_id` are all set:

```bash
curl -X POST http://localhost:3000/api/admin/calendar/sync \
  -H "x-sync-secret: <your gcal_sync_secret>"
```

or, signed in as a mentor/admin in the browser, hit the same endpoint from an authenticated
`fetch` (a "Sync now" button can call this directly). A successful sync returns
`{ "meetings": <n>, "buildDays": <n> }`.

If any of `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, or `gcal_calendar_id` are missing, the
route returns `400 { "error": "not_configured" }` — that's expected until you finish steps 1–3.

## Local vs credential-gated

The manual build-day path (Task 4 — admins add/edit `build_day` rows directly in the UI) is the
locally-verified path: it's covered by unit tests and confirmed working without any external
credentials. The Google Calendar round-trip described here is **credential-gated on you**, the same
way `docs/setup/google-oauth.md` is: it needs a real Google Cloud project, a real service account,
and a real calendar share, none of which can be created autonomously. `syncCalendar` itself is fully
unit-tested with an injected fake `fetch` and fake db (`src/lib/gcal.test.ts`) — the logic is
verified; only the live Google round-trip depends on you completing the steps above.
