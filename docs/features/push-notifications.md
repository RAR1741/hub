# Push notifications

Web Push notifications to a member's browser/device, on one shared VAPID pipeline
(`sendPushToOptedIn()`). Setup/config: [Web Push setup](../setup/web-push.md). Testing, verifying,
and troubleshooting (local + prod): [notifications runbook](../setup/notifications-runbook.md).

## Off by default, two-step opt-in

Nothing pushes to anyone until they opt in, in two steps:

1. **Enable push on a device** — `/me/notifications` has an "Enable on this device" button that
   registers the service worker, requests browser notification permission, subscribes, and POSTs
   the subscription to `POST /api/push/subscribe`.
2. **Toggle each type on** — once a device is enabled, the same page lists a per-type toggle
   (`PATCH /api/notifications/prefs`) for every type available to the viewer's role. A type stays
   off until explicitly turned on, even after step 1.

A member with a device enabled but every type off receives nothing. Both steps are required.

## The six types

| Type | Who can enable it | Fires when |
| --- | --- | --- |
| `admin_alerts` | admins | a sync-failure/recovery alert would post to `#hub-admin-alerts` |
| `clocked_in_late` | all members | nightly cron, to members with an open (not-yet-clocked-out) session |
| `meeting_reminder` | all members | before each meeting starts, at whatever lead time(s) the member picked — see [Meeting and event reminders](#meeting-and-event-reminders) |
| `consent_missing` | mentors, admins | the weekly mentor FIRST-reminder run, to mentors with outstanding items |
| `meeting_changed` | all members | a meeting's start time moves (manual edit or Google Calendar sync), only for a still-future meeting |
| `system_health` | admins | a hub subsystem's health changes (currently: `#hub-admin-alerts` delivery starts failing or recovers). Push-only by design so it still arrives when Slack is the broken piece. Deduped per subsystem via `app_setting.system_health_state_<subsystem>`, same transition rule as sync alerts. |

Role-restricted types (`admin_alerts`, `consent_missing`, `system_health`) are enforced server-side when toggling
— a student can't enable these by calling the API directly.

Event reminders are **not** one of the six types — see below.

## Meeting and event reminders

Both let a member pick one or more lead times from `{15, 30, 60, 120}` minutes, but they opt in
differently:

- **Meetings** — one **global** set of lead times per person
  (`person.meeting_reminder_minutes`, default `{60}`), set on `/me/notifications` under the
  `meeting_reminder` toggle and applied to every meeting. Still gated behind that toggle being on
  — turning it off stops all meeting reminders regardless of the lead-time set. This replaces the
  old fixed 3-hour team-wide meeting reminder.
- **Events** — lead times are chosen **per signup**, in an optional reminder picker on the sign-up
  flow (see [events-and-forms.md](events-and-forms.md)), and stored in `event_signup_reminder`.
  There is no separate "event reminder" notification type to turn on — picking an offset at
  sign-up time *is* the opt-in. A member who picks a lead time but has no push-enabled device
  still receives nothing; the picker shows a hint pointing at `/me/notifications`.

Both are swept by a single cron, **`push-reminders`**, every 5 minutes
(`POST /api/cron/push/reminders`) — see [setup/web-push.md](../setup/web-push.md). It replaces
the old hourly `push-meeting-reminder` job/route.

## Managing notifications

- **`/me/notifications`** — enable/disable this device, and toggle each available type.
- **Home dashboard card** — "Turn on notifications", shown to any signed-in member who hasn't
  enabled push or dismissed the card (dismissal is per-browser, `localStorage`). Guests never see
  it.

## iOS requirement

Web Push only reaches an iOS device when the hub has been **added to the Home Screen** as a PWA,
on **iOS 16.4+**. Opening the site in Safari without installing it will not deliver anything, even
after "Enable on this device" appears to succeed. `/me/notifications` shows an "Add to Home
Screen" hint on iOS.
