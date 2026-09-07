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

## The five types

| Type | Who can enable it | Fires when |
| --- | --- | --- |
| `admin_alerts` | admins | a sync-failure/recovery alert would post to `#hub-admin-alerts` |
| `clocked_in_late` | all members | nightly cron, to members with an open (not-yet-clocked-out) session |
| `meeting_reminder` | all members | a few hours before a meeting starts |
| `consent_missing` | mentors, admins | the weekly mentor FIRST-reminder run, to mentors with outstanding items |
| `meeting_changed` | all members | a meeting's start time moves (manual edit or Google Calendar sync), only for a still-future meeting |

Role-restricted types (`admin_alerts`, `consent_missing`) are enforced server-side when toggling
— a student can't enable `admin_alerts` by calling the API directly.

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
