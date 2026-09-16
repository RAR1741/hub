# Push notifications (Web Push)

**Date:** 2026-09-06
**Issue:** [#248](https://github.com/RAR1741/hub/issues/248)
**Status:** Draft design, pending review

## Scope

Deliver browser Web Push notifications to hub members. v1 ships **five
notification types** on one shared push pipeline:

| Type | Who can enable | Trigger | Recipients |
| --- | --- | --- | --- |
| `admin_alerts` | admins | a message posts to `#hub-admin-alerts` (existing) | opted-in admins |
| `clocked_in_late` | all members | nightly evening cron (new) | opted-in members with an open session |
| `meeting_reminder` | all members | cron a few hours before a meeting (new) | all opted-in members |
| `consent_missing` | mentors, admins | weekly mentor-reminder run (existing) | opted-in mentors with outstanding FIRST items |
| `meeting_changed` | all members | a meeting's `starts_at` changes (manual edit or gcal sync) | all opted-in members |

**Everything is off by default.** Two independent steps: (1) enable push on a
device (grant permission + subscribe), and (2) toggle each type on. No type is
ever on until the person turns it on. This is the explicit requirement — a
person is never notified for anything they did not opt into.

The issue's premise that the hub "is already a Next.js PWA" is wrong: there is
no manifest, no service worker, and no `appleWebApp` metadata today. That
plumbing is in scope, because a service worker is required to receive Web Push
at all, and on iOS the app must be installed to the home screen first (16.4+).

## Design principle: one core, five thin triggers

The hard part — VAPID, RFC 8291 payload encryption, subscription storage,
delivery, dead-endpoint pruning — is built **once** as a shared dispatcher.
Each of the five types is a thin caller that (a) computes its recipient person
set, (b) filters that set by opt-in, (c) builds a payload, and (d) hands it to
the core. Adding a sixth type later is another thin caller, no core change.

### Shared core: `src/lib/push-dispatch.ts`

```ts
export type PushDeps = {
  vapid: { publicKey: string; privateKey: string; subject: string } | null; // null = unconfigured
  send: typeof import("web-push").sendNotification;                          // injectable for tests
};

export function pushDepsFromEnv(): PushDeps;

/** Send one payload to every push subscription owned by these persons who have
 *  opted into `type`. Never throws. No-ops (logged) when VAPID is unconfigured.
 *  Prunes any subscription the push service reports 404/410 for.
 *  `personIds` may be "all" — every active person, so meeting-wide types don't
 *  select every id first. */
export async function sendPushToOptedIn(
  personIds: string[] | "all",
  type: NotificationType,
  payload: { title: string; body: string; url: string },
  deps: { db: SupabaseClient; push?: PushDeps },
): Promise<{ sent: number; pruned: number }>;
```

- Loads `push_subscription` rows for `personIds` (or all persons when `"all"`)
  whose owner is `is_active` and has `type = any(person.notification_types)`
  (one query, joined/filtered). `is_active` mirrors the mentor-reminder filter —
  a departed member never gets pushed.
- Sends each with `web-push` under a bounded `Promise.allSettled`, each send
  with its own timeout.
- On `404`/`410`, deletes that subscription row (endpoint permanently gone).
- **Missing VAPID keys ⇒ logged no-op**, mirroring Slack's "no token ⇒ no-op".

### Data model

One migration adds a table and three columns.

```sql
create table push_subscription (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references person(id) on delete cascade,
  endpoint     text not null unique,   -- push service URL
  p256dh       text not null,          -- client public key
  auth         text not null,          -- client auth secret
  user_agent   text,                   -- device list / debugging
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index on push_subscription (person_id);
-- REQUIRED: service_role GRANT (RLS-enabled, zero policies like every table),
-- or every query 42501s on a fresh DB.

-- Per-person opt-in list. Absent value = that type OFF. Empty array = all off.
alter table person add column notification_types text[] not null default '{}';

-- Dedupe marker so the meeting-reminder cron reminds each meeting once.
alter table meeting add column reminder_pushed_at timestamptz;
```

Chose a `text[]` column over a `notification_pref` join table: v1 needs one
boolean per type, no per-type config. (Quiet hours were explicitly deferred.)
If a type later needs config, migrate to a table then. Type values live in a
`NotificationType` union in `src/lib/notification-types.ts` alongside each
type's label and the roles it is available to (drives the settings UI and the
per-type role check).

### VAPID + `web-push`

Add the `web-push` dependency. Three env vars, keys injected via `PushDeps`:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — the public key. Read by both the client
  (`applicationServerKey` for subscribe) and the server (a `NEXT_PUBLIC_` var is
  readable server-side too), so there is no separate `VAPID_PUBLIC_KEY` to keep
  in sync.
- `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`) — server only.

Missing private key ⇒ dispatch no-ops (logged). Missing public key ⇒ the
settings page shows "not configured on this server" instead of a throwing
button.

### Payload

Push payloads are plain, not Slack mrkdwn. A small sanitizer strips emoji
shortcodes and fenced code blocks (Slack alert text carries both, including raw
error output — wrong for a lock screen). The service worker opens `data.url`
resolved against `self.location.origin` on click.

### Service worker + manifest (PWA plumbing)

- **`public/sw.js`** (static, origin-root scope `/`): a `push` handler
  (`showNotification`) and a `notificationclick` handler (focus an existing tab
  or open `data.url`). No offline caching, no precache. Registered **only from
  the opt-in flow** on `/me/notifications`, never in `layout.tsx`, so kiosk and
  logged-out devices are untouched.
- **`app/manifest.ts`** (`MetadataRoute.Manifest`): name "1741 Hub",
  `display: "standalone"`, `start_url: "/"`, theme/background colors, icons at
  192×192 and 512×512 (maskable), generated from the square 270×270
  `src/app/icon.png`; verify the generated PNGs render. Next auto-injects the
  `<link rel="manifest">` when this file exists — no `manifest` metadata field.
- **`layout.tsx` metadata**: add `appleWebApp`.
- **iOS caveat**: Web Push reaches an iOS PWA only when added to the home
  screen (16.4+). The opt-in flow shows an "Add to Home Screen" hint on iOS
  Safari; the limitation is documented, not worked around.

## The five triggers

### `admin_alerts` — piggyback on Slack posts (no cron)

Both producers of `#hub-admin-alerts` messages call `postChannelMessage(slack,
"hub-admin-alerts", text)`: `reportSyncOutcome` (`src/lib/slack-alerts.ts`) and
the weekly summary (`src/lib/mentor-reminders.ts`). Introduce
`notifyAdmins(text, deps): Promise<boolean>` in `src/lib/admin-notify.ts` that
both call instead. It posts to Slack exactly as before, then calls
`sendPushToOptedIn(<admin ids>, "admin_alerts", …)`, and **returns Slack's
`delivered` boolean unchanged.**

The passthrough is load-bearing: `reportSyncOutcome` advances its
`slack_alert_state_<source>` state machine on that boolean. Push outcome must
never leak into it. The push fan-out is `await`ed (an unawaited promise can be
killed when the Vercel function returns) but wrapped so it can neither throw nor
change the return value.

- **Alternative rejected:** intercepting inside `postChannelMessage`. That
  couples pure `slack.ts` (no DB dependency) to the DB and `web-push`. Keep
  slack.ts pure; put the fan-out in `admin-notify.ts`.

### `clocked_in_late` — nightly evening cron (new)

New route `POST /api/cron/push/clocked-in-late`, guarded by `x-sync-secret`
against `getSetting("push_cron_secret", …)` — the exact pattern of the existing
mentor-reminders cron. pg_cron cannot call `getTeamTimezone()`, so the schedule
is a **fixed UTC hour** in the migration, adjustable via the existing
`/admin/cron` editor (the established pattern; DST drift accepted). Pick an
evening-local hour — e.g. `0 3 * * *` (03:00 UTC ≈ 8pm Pacific / 11pm Eastern).
It **must fire before the 08:00 UTC `close-stale-sessions` sweep**, or there is
nothing left to nudge. It finds sessions with `time_out is null`, then
`sendPushToOptedIn(<those person ids>, "clocked_in_late", …)` — "You're still
clocked in — forget to clock out?", `url: "/me/attendance"`.

### `meeting_reminder` — pre-meeting cron (new)

New route `POST /api/cron/push/meeting-reminder`, same shared `push_cron_secret`
gate, scheduled hourly. It selects meetings with `starts_at` between now and
now + **3 hours** and `reminder_pushed_at is null`, sends
`sendPushToOptedIn("all", "meeting_reminder", …)` — title from the meeting,
noting required vs optional via the linked `build_day.kind` — then stamps
`reminder_pushed_at` so each meeting reminds once. Every synced meeting has a
`build_day` (the gcal sync creates one per meeting date), so "all future
meetings" and "all build-day meetings" are the same set — no orphan-event
filtering needed. Meetings are team-wide (no attendee model), so recipients are
all opted-in members. `url: "/calendar"`.

### `consent_missing` — piggyback on the weekly mentor run (no new cron)

`sendMentorReminders` already loops mentors/admins and computes
`outstandingItems(m)` per person before DMing Slack. In that same loop, for a
mentor who has outstanding items, also `sendPushToOptedIn([m.personId],
"consent_missing", …)` — "You still have outstanding FIRST requirements",
`url: "/admin/first-status"` (the existing FIRST status page). No new schedule;
it rides the existing weekly cron. Slack DM behavior is unchanged; push is
additive and independent.

### `meeting_changed` — at the write sites where `starts_at` moves

A meeting's start time changes in exactly two places: the manual admin edit
(`updateMeeting` in `src/lib/meetings.ts`) and the Google Calendar sync upsert
(in the gcal sync path — `src/lib/gcal.ts` / the calendar sync route; locate
precisely during implementation). At each, compare the stored `starts_at` to
the new one; fire **only when a prior row existed and the new `starts_at` is in
the future** (never on insert — there is no prior time — and never for a meeting
already past). If it moved, `sendPushToOptedIn("all", "meeting_changed", …)` —
"Meeting time changed: <title> is now <new time>", `url: "/calendar"` — **and
reset `reminder_pushed_at = null`** on that row so the moved meeting re-reminds
at its new time (otherwise a meeting reminded for today, then moved to next
week, would never remind again). This is the most involved trigger because it
requires reading the prior row before writing in the sync path; sequence it
last.

## API routes

All are mutations gated with `withRole("student", …)` from `src/lib/api.ts` —
resolves the viewer, enforces a non-guest role, and **blocks the write while
masquerading** (so an admin masquerading as a student cannot subscribe their
own browser under the student's id). Because they use `withRole`, they need no
`route-auth-allowlist` entry.

- `POST /api/push/subscribe` — `{ endpoint, keys: { p256dh, auth } }`; reject a
  non-`https` endpoint; upsert by `endpoint` for `viewer.person`.
- `POST /api/push/unsubscribe` — `{ endpoint }`; delete the viewer-owned row.
- `PATCH /api/notifications/prefs` — `{ type, enabled }`; add/remove the type
  from `viewer.person.notification_types`. Accept only known types; enforce each
  type's role availability (e.g. `admin_alerts` only when `viewer.role ===
  "admin"`, `consent_missing` only for mentor/admin) inside the handler, above
  the route's `student` floor.

The VAPID public key is read client-side from `NEXT_PUBLIC_VAPID_PUBLIC_KEY`;
no route exposes it.

The two new cron routes (`api/cron/push/clocked-in-late/route.ts`,
`api/cron/push/meeting-reminder/route.ts`) are secret-gated, not `withRole`, so
each needs a `ROUTE_AUTH_ALLOWLIST` entry in `route-auth-allowlist.test.ts` or
that guardrail test fails — copy the mentor-reminders wording: "x-sync-secret
compared in constant time (secureEqual); fails closed when unset."

## UI

- **`/me/notifications`** (server component; `getViewer()`, redirect to
  `/login` if not signed in): an "Enable on this device" button (registers the
  SW, requests `Notification` permission, subscribes, POSTs to
  `/api/push/subscribe`), the list of this device's subscription state, and a
  per-type toggle for each type available to the viewer's role. If
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is unset, show "not configured on this server".
- **Home dashboard card** "Turn on notifications", dismissible
  (`localStorage`), shown to any signed-in member who has not enabled or
  dismissed it. All members have at least the meeting types available, so the
  card is not the empty-prompt spam the "off by default" rule guards against;
  guests never see it.

## Error handling

| Failure | Behavior |
| --- | --- |
| Server VAPID keys unset | Dispatch logs and no-ops; Slack/DM/cron unaffected |
| Public VAPID key unset | Settings page shows "not configured"; no throwing button |
| A single push send fails/times out | Swallowed; other sends proceed |
| Push service returns 404/410 | That `push_subscription` row is deleted |
| Whole push fan-out throws | Caught; `notifyAdmins` still returns Slack's `delivered` |
| Cron secret missing/wrong | Route 403s (existing pattern); no sends |
| Subscribe/prefs while masquerading | 403 from `withRole` |
| Duplicate subscribe (same endpoint) | Upsert; one row per endpoint |
| Meeting reminder cron re-runs | `reminder_pushed_at` stamp prevents re-reminding |

## Testing

- **Unit:** the core `sendPushToOptedIn` (opt-in + recipient filtering, 404/410
  pruning, unconfigured no-op, per-send timeout); `notifyAdmins` (returns
  Slack's `delivered` unchanged, never throws on push failure); each trigger's
  recipient computation (open-session set; meeting-window + dedupe stamp;
  mentor-with-items set; `starts_at`-moved detection); `subscribe` (stores for
  viewer, rejects non-https, masquerade 403); `prefs` (known types only, per-type
  role gate); the payload sanitizer (strips emoji and fenced code).
- **E2E (Playwright):** `/me/notifications` renders the toggles available to the
  role and a toggle persists; a guest is redirected. A real push cannot be
  received in CI (no push service), so the subscribe-to-receive round trip is a
  manual checklist item.
- **Manual checklist:** real browser — enable, then for each type trigger it
  (flip a sync to failing; be clocked in at the cron hour; a meeting within the
  lead window; a mentor with outstanding items; move a meeting's time) and
  confirm the push arrives and the click lands on the right page; on iOS, add to
  home screen first.

## Rollout

- Generate keys once (host has no node): `./dev npx web-push generate-vapid-keys`.
- Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`
  in Vercel (all environments) and in local `.env`. **Rotating the VAPID keys
  invalidates every existing subscription** — document this loudly.
- The migration auto-applies on merge via the Supabase GitHub integration
  (include the `service_role` GRANT for `push_subscription`, one shared
  `push_cron_secret` `app_setting` row, and the two pg_cron schedules, following
  the mentor-reminders cron migration). **Check `origin/master` for a colliding
  migration timestamp before naming it** — parallel worktrees have collided.
- **Per-env cron config or it silently no-ops:** the shared `push_cron_secret`
  `app_setting` row must be set per environment in prod, exactly like the
  existing FIRST/Slack crons. Document in the setup doc from day one.
- Docs: `docs/setup/web-push.md` (key generation, per-env config, the rotation
  warning, the iOS install caveat, the cron secret) and
  `docs/features/push-notifications.md`, plus an entry in `docs/features.md`.
  Add the three VAPID env vars to `.env.example`.
- Closes #248.
