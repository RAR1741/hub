# FIRST roster sync

Mentors and admins must complete FIRST's Youth Protection Program (YPP) steps — consent & release,
screening, training — before working with students. FIRST tracks this on `my.firstinspires.org`,
which has no public API. **Admin → FIRST status** (`/admin/first-status`) pulls that data into the
hub by scraping the team roster page with a human-supplied session cookie, matches each FIRST
roster entry to a hub person, and shows every mentor/admin's status at a glance.

## The session model

There's no automated login — FIRST has no API credentials to authenticate with. An admin signs
into `my.firstinspires.org` in their own browser, copies the session cookie, and pastes it into
the **FIRST session** card on `/admin/first-status`. That POSTs to `/api/admin/first/session`
(`src/app/api/admin/first/session/route.ts`), which validates the cookie against the roster page
before saving it to `app_setting.first_session`.

The cookie has a sliding expiration — it renews on each authenticated request. `syncFirstRoster()`
(`src/lib/first-sync.ts`) persists the rotated cookie back to `first_session` after every sync, so
frequent syncing keeps the session alive. If FIRST rejects the cookie (login redirect instead of
roster data), the sync fails with `session_expired`; the page surfaces a banner asking for a fresh
paste, and the "unmatched" section is unavailable until a sync succeeds again.

## What a sync does

`POST /api/admin/first/sync` runs `syncFirstRoster()`:

1. Fetches the team roster page and extracts the `teamContactsModel` JSON embedded in the HTML
   (`parseTeamContactsModel()`) — the page repeats that identifier many times, so the parser only
   accepts an assignment (`= {`) whose object literal contains `PeopleRoles`.
2. Filters to adult roles (`Primary Team Contacts`, `Additional Team Contacts`), dedupes by FIRST
   `peopleId` (`adultsFromModel()`).
3. Fetches per-person screening/training status from `GetPersonStatus` (requires repeated `ids=`
   query params — a comma-separated list silently returns nothing).
4. Matches each FIRST person to a hub `person` (`matchFirstToHub()`), first rung wins, each hub
   candidate claimable once:
   - existing `person.first_people_id`,
   - an email in `person.email` or `person_identity`, case-insensitive,
   - normalized name match (`nameKey()`).
5. Writes `first_people_id`, `first_consent_release`, `first_screening_status`,
   `first_screening_text`, `first_training_status`, `first_synced_at` onto matched people.
6. Saves a `FirstSyncReport` to `app_setting.first_last_sync_report` — counts, and the lists of
   unmatched FIRST entries and unmatched hub mentors/admins (active, no `first_people_id`).

## Linking unmatched entries

A FIRST roster entry with no match (new hire, name/email mismatch) shows under **Unmatched FIRST
roster entries** with a picker to link it to an existing hub person. That calls
`PATCH /api/admin/first/link` (`src/app/api/admin/first/link/route.ts`), which sets
`person.first_people_id` directly — the next sync then fills in the rest of that person's status
fields. A unique-constraint conflict (that FIRST id already claimed by someone else) returns
`already_linked`.

## Status on the person page

Mentors/admins get a **FIRST status** card on their own person page (`/people/[id]`) — visible to
an admin viewing anyone, or a mentor viewing themselves. It shows consent, YPP screening, and YPP
training as status badges, or "Not linked to a FIRST roster record yet" if `first_people_id` is
null.

## Automatic sync

A pg_cron job (`first-roster-sync`, `*/15 * * * *`) POSTs `/api/admin/first/sync` every 15 minutes,
in addition to the **Sync now** button on `/admin/first-status`. The route is dual-gated:

- a shared secret via the `x-sync-secret` header, checked against `app_setting.first_sync_secret`
  (what the cron sends — an empty secret never authorizes), or
- an admin session (what the button uses) — mentors cannot trigger or view this data.

A sync failure or recovery posts to `#hub-admin-alerts` via `reportSyncOutcome()`
(`src/lib/slack-alerts.ts`) — see [Slack integration](slack-integration.md).

## Configuration note

`first_sync_url` and `first_sync_secret` (the cron's POST target and shared secret) are
`app_setting` rows seeded to local-dev defaults by the migration — they must be set per environment
or the cron silently no-ops in prod. `first_team_profile_id` identifies which FIRST team roster to
scrape. There's no dedicated setup runbook for FIRST sync; these are plain `app_setting` values, set
the same way as the other cron secrets described in [Slack setup](../setup/slack.md).
