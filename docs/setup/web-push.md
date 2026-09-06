# Setting up Web Push notifications

The hub can push five notification types straight to a member's browser/device:
`admin_alerts`, `clocked_in_late`, `meeting_reminder`, `consent_missing`, and `meeting_changed`.
Everything is off by default and shares one VAPID key pair and one dispatch pipeline
(`sendPushToOptedIn()`). See [features/push-notifications.md](../features/push-notifications.md)
for the member-facing behavior; this doc is config only.

## 1. Generate the VAPID key pair

```bash
./dev npx web-push generate-vapid-keys
```

This prints a public and private key. Generate it **once per environment** you actually run
(local, prod) — do not reuse the same pair everywhere unless you want subscriptions to be
portable across them, which they aren't since each is a fresh browser subscription anyway.

**Rotation warning:** rotating the VAPID keys invalidates **every existing subscription**. Every
device that previously enabled push on `/me/notifications` silently stops receiving anything and
has to re-enable. Don't rotate casually — only if the private key is compromised.

## 2. Set the three env vars

| Var | Where |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public key. Read by both the browser subscribe call and the server dispatch, so there's no separate server-only public key. |
| `VAPID_PRIVATE_KEY` | Private key. Server only. |
| `VAPID_SUBJECT` | A `mailto:` contact, e.g. `mailto:automation@redalert1741.org`. |

Local: add all three to `.env` (see `.env.example`). Prod: Project → Settings → Environment
Variables in Vercel, scoped to **all environments** (Production/Preview/Development) — the same
key pair everywhere is fine for preview/dev unless you specifically want to isolate them.
**Redeploy** after setting them; env changes only take effect on a new deployment.

Missing/empty `VAPID_PRIVATE_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is a logged no-op everywhere —
mirrors the Slack "no token ⇒ no-op" pattern. Nothing errors; dispatch just skips.

## 3. Set the prod `app_setting` rows

Same pattern as the FIRST/Slack crons: the migration seeds dev defaults / an empty secret, so
these **must** be overridden in prod or the two push crons (`clocked_in_late`,
`meeting_reminder`) silently no-op forever. Run in the **prod** Supabase SQL editor:

```sql
insert into app_setting (key, value) values
  ('push_cron_secret', '"REPLACE_WITH_A_LONG_RANDOM_SECRET"'),
  ('push_clocked_in_late_url', '"https://hub.redalert1741.org/api/cron/push/clocked-in-late"'),
  ('push_meeting_reminder_url', '"https://hub.redalert1741.org/api/cron/push/meeting-reminder"')
on conflict (key) do update set value = excluded.value;
```

`push_cron_secret` is shared by both cron routes (`x-sync-secret` header, constant-time
compared) — one secret, not two. The `value` column is `jsonb`; keep the inner double-quotes.

Verify:

```sql
select key, value from app_setting
where key in ('push_cron_secret', 'push_clocked_in_late_url', 'push_meeting_reminder_url');
```

## 4. iOS caveat

Web Push only reaches an iOS Safari PWA when the app has been **added to the Home Screen**, on
**iOS 16.4+**. A member who just visits the site in Safari and hits "Enable on this device" will
see the subscribe succeed but never receive anything on iOS unless it's installed first. The
`/me/notifications` opt-in flow shows an "Add to Home Screen" hint on iOS for this reason — don't
remove it without an alternative.

## Troubleshooting

- **Nothing sends anywhere** — check `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` are set
  and the app was redeployed after setting them.
- **Cron never fires / always no-ops in prod** — `push_clocked_in_late_url` or
  `push_meeting_reminder_url` still point at dev defaults, or `push_cron_secret` is still empty.
  Set all three (step 3).
- **A member re-enabled push after it stopped working** — likely a VAPID key rotation; that's
  expected, not a bug.
- **iOS device never gets a push** — confirm it was added to the Home Screen, not just opened in
  Safari, and is on iOS 16.4+.
