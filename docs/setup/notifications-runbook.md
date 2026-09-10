# Notifications runbook

Operational guide for **Web Push notifications** — how to set up, fire a test, verify, and
troubleshoot, in local dev and in prod. This is the "how do I actually exercise it" companion to
the two reference docs:

- **Behavior** (what fires, who opts in): [features/push-notifications.md](../features/push-notifications.md)
- **Config reference** (env vars, `app_setting` rows, iOS, rotation): [setup/web-push.md](web-push.md)

The six types — `admin_alerts`, `clocked_in_late`, `meeting_reminder`, `consent_missing`,
`meeting_changed`, and `system_health` — share one VAPID pipeline (`sendPushToOptedIn()`) and are **all off by
default**. Enabling push on a device and toggling a type on are two separate steps.

`localhost` is a secure context, so Web Push works in Chrome/Edge/Firefox against a local site
with no HTTPS. (iOS Safari is the exception — it needs the PWA installed to the Home Screen on
16.4+; see web-push.md.)

---

## Part 1 — Local dev

### 1.1 One-time setup

VAPID keys live in `.env.local` (gitignored, per-worktree). If push is unconfigured the whole
pipeline is a logged no-op — nothing errors, nothing sends — so this step is required to see
anything.

```bash
# Generate a key pair (once per checkout/worktree; any pair works locally)
./dev npx web-push generate-vapid-keys
```

Add the three vars to `.env.local`:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:automation@redalert1741.org
```

Restart so `next dev` picks them up (NEXT_PUBLIC vars are read at dev-server start):

```bash
docker compose restart app
```

Confirm it loaded: the startup log should show `- Environments: .env.local, .env`. Your app URL
is this worktree's `APP_PORT` (e.g. `http://localhost:3011` — the main checkout is `:3000`); see
`.env` / the stack's startup banner.

### 1.2 Subscribe a browser

1. Open the app in Chrome → **Log in as Admin** (dev-login on `/login`).
2. Go to **`/me/notifications`** → **Enable on this device** → **Allow** the browser prompt.
3. (Only needed for the real-path triggers below, not the tester) toggle the type you want on.

### 1.3 Fire a test — three ways

**A. The push tester (recommended).** A dev-only, admin-only page that fires a real push to
**your own devices, ignoring opt-in prefs** — no seeding, no toggling.

- Go to **`/admin/push-test`** (or the **🔧 Dev: push notification tester** link on
  `/me/notifications`). Pick a type, optionally set title/body/url, **Send test push**. It reports
  `Sent to N device(s)`.
- It is unreachable on any deploy (`VERCEL_ENV`-gated) — local `next dev` only. Source:
  `src/app/admin/push-test/`.

**B. DevTools push (fastest, no server send).** Verifies the service worker renders a
notification. Chrome DevTools → **Application → Service Workers** → find `/sw.js` → **Push**, and
send this payload (the SW expects JSON `{title, body, url}`):

```json
{"title":"1741 Hub","body":"It works!","url":"/me/notifications"}
```

**C. Exercise a real cron end-to-end.** Uses the shipped cron route, which sweeps both meeting and
event reminders in one call. First set the local cron secret (the column is `jsonb` — keep the
inner quotes, or the update is rejected and the route keeps 403ing):

```bash
./dev npm run -s db:psql -- -tAc "update app_setting set value='\"localdev\"'::jsonb where key='push_cron_secret';"
```

Then, with *Meeting reminders* toggled on (and a lead time picked, default `{60}`) for your
subscribed user, insert a meeting ~1h out and fire the cron (in-container the app is always
`localhost:3000`):

```bash
./dev npm run -s db:psql -- -tAc "insert into meeting (title, starts_at, ends_at) values ('Local push test', now()+interval '1 hour', now()+interval '2 hours');"
./dev bash -lc "curl -sS -X POST http://localhost:3000/api/cron/push/reminders -H 'x-sync-secret: localdev'"
```

Expected: `{"ok":true,"events":{...},"meetings":{"sent":1,"pruned":0,"meetings":1}}` and a
notification in Chrome. A fired meeting offset is stamped into `reminder_pushed_minutes`; to
re-fire, insert a fresh meeting or `update meeting set reminder_pushed_minutes = '{}';`. For an
event reminder, pick an offset on the sign-up picker instead of toggling a notification type —
it's stamped per `(event, person, minutes)` in `event_signup_reminder.pushed_at`; to re-fire,
`update event_signup_reminder set pushed_at = null where event_id = '<id>';`.

### 1.4 Reset

```bash
# See who's subscribed / opted into what
./dev npm run -s db:psql -- -tAc "select p.display_name, s.user_agent, p.notification_types from push_subscription s join person p on p.id = s.person_id;"
# Wipe all local subscriptions (each browser must re-enable afterward)
./dev npm run -s db:psql -- -tAc "delete from push_subscription;"
```

---

## Part 2 — Remote / prod

Prod is `hub.redalert1741.org` (Vercel, auto-deploy on merge to `master`). Schema — the
`push_subscription` table, the two pg_cron jobs, and the seeded (empty/off) `app_setting` rows —
ships automatically via the Supabase GitHub integration when the PR merges. What does **not**
ship automatically is the secrets/URLs; set those once, or the feature stays a silent no-op by
design.

> Prod changes below are the operator's to run in the Vercel and Supabase dashboards. Treat SQL
> here as run in the **prod** Supabase SQL editor.

### 2.1 One-time config after first deploy

Full detail in [web-push.md](web-push.md); the checklist:

1. **Vercel env vars** (Project → Settings → Environment Variables, all environments), then
   **redeploy**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Generate a
   prod-only key pair — do not reuse the local one.
2. **`app_setting` rows** (prod SQL editor):

   ```sql
   insert into app_setting (key, value) values
     ('push_cron_secret', '"<LONG_RANDOM_SECRET>"'),
     ('push_clocked_in_late_url', '"https://hub.redalert1741.org/api/cron/push/clocked-in-late"'),
     ('push_reminders_url', '"https://hub.redalert1741.org/api/cron/push/reminders"')
   on conflict (key) do update set value = excluded.value;
   ```

   `push_cron_secret` is shared by both cron routes. `value` is `jsonb` — keep the inner quotes.

### 2.2 Verify config is live

```sql
-- All three rows present and non-empty (secret shown as length only)
select key,
       case when key = 'push_cron_secret' then length(value #>> '{}')::text || ' chars' else value #>> '{}' end
from app_setting
where key in ('push_cron_secret','push_clocked_in_late_url','push_reminders_url');

-- Both pg_cron jobs scheduled and active
select jobname, schedule, active from cron.job
where jobname in ('push-clocked-in-late','push-reminders');
```

Expected jobs: `push-clocked-in-late` @ `0 3 * * *` (03:00 UTC nightly, before the 08:00 UTC
auto-close sweep) and `push-reminders` @ `*/5 * * * *` (every 5 minutes, sweeping both meeting and
event reminders). VAPID env is confirmed indirectly by 2.3 actually delivering.

### 2.3 Manually verify a cron in prod

Fire the route yourself instead of waiting for the schedule (needs the real secret):

```bash
curl -sS -X POST https://hub.redalert1741.org/api/cron/push/reminders \
  -H "x-sync-secret: <push_cron_secret>"
```

- `{"ok":true,"events":{...},"meetings":{...}}` → working; each sweep's counts reflect targets in
  the next window with opted-in recipients.
- `403` → `push_cron_secret` unset/mismatched (2.1).
- `502` → the handler threw; check Vercel function logs for `reminders push failed`.

### 2.4 Confirm pg_cron is actually running the job

```sql
select j.jobname, r.status, r.start_time, r.return_message
from cron.job_run_details r join cron.job j on j.jobid = r.jobid
where j.jobname like 'push-%'
order by r.start_time desc limit 10;
```

A `net.http_post` row with `status = 'succeeded'` means pg_cron fired and pg_net dispatched; the
actual push count is in the Vercel function logs, not here.

### 2.5 Operations

- **Rotate keys** (only if the private key leaks): set new VAPID vars + redeploy. This
  **invalidates every existing subscription** — every device must re-enable. Not a casual action.
- **Rotate the cron secret**: update `push_cron_secret` in prod SQL; takes effect immediately (no
  deploy — the route reads it per-request).
- **Pause a cron**: `select cron.unschedule('push-reminders');` (re-add via a migration, or
  re-run the `cron.schedule(...)` from `supabase/migrations/20260910120100_push_reminders_cron.sql`).
  Prefer a migration for anything permanent.
- **Kill switch for all push**: clear `VAPID_PRIVATE_KEY` in Vercel and redeploy — every dispatch
  becomes a logged no-op instantly, no data lost.

---

## Troubleshooting quick reference

| Symptom | Cause / fix |
| --- | --- |
| Nothing sends anywhere | VAPID vars unset, or not redeployed after setting (prod) / stack not restarted (local). |
| Cron route returns 403 | `push_cron_secret` empty or mismatched. Local: set it as `jsonb` (1.3C). Prod: 2.1. |
| Cron returns `{"sent":0}` | No qualifying recipients — nobody opted into that type, or no meeting in the window. Not an error. |
| Cron returns 502 | Handler threw; check function logs (`… push failed`). |
| Member re-enabled after it "stopped" | Expected after a VAPID key rotation — subscriptions were invalidated. |
| iOS device never receives | Must be added to the Home Screen as a PWA on iOS 16.4+, not just opened in Safari. |
| `/admin/push-test` is 404 | Working as designed off `next dev` — it's blocked on every deploy and in prod-mode builds. |
| Local secret update "did nothing" | The `value` column is `jsonb`; a bare string is rejected — use `'"localdev"'::jsonb`. |
