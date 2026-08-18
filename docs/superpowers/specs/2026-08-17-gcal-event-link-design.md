# Google Calendar event linking

## Problem

`event` rows (one-off, self-service-signup gatherings) are created and edited by hand today. Admins often want them to mirror something already on the team's Google Calendar (a scouting trip, a demo, a social) rather than retype the name/date/time — and if that calendar event later moves, the `event` row should follow.

This is distinct from the existing `meeting` sync (`src/lib/gcal.ts`), which is a one-way read-only mirror of the whole calendar used to drive attendance/build-day tracking. That sync already pulls every calendar event into `meeting` regardless of type — we reuse that data instead of hitting the Google API again.

## Data model

Migration `supabase/migrations/<ts>_event_gcal_link.sql`, additive to `event`:

- `gcal_event_id text` — nullable, references the same Google Calendar event id already present in `meeting.gcal_event_id`. Unique partial index (`where gcal_event_id is not null`) so one calendar event can't back two `event` rows.
- `gcal_missing boolean not null default false` — flips true when a sync notices the linked calendar event is gone (deleted upstream, or fell out of the meeting-sync window). Surfaced to admins for manual review; never auto-unlinks.

No changes to `meeting`, `event_signup`, or `session`.

## Suggesting candidates

New endpoint `GET /api/admin/events/gcal-candidates` (mentor+ only, same guard as other `/api/admin/events/*` routes): selects `meeting` rows with `starts_at >= now` whose `gcal_event_id` is not already claimed by an `event` row. Returns `{ id, title, starts_at, ends_at }[]`.

No live Google Calendar API call from the admin UI — the existing sync cron already keeps `meeting` current, so this is a plain Supabase query.

`EventForm.tsx` gains an optional "Attach to a calendar event" dropdown fed by this endpoint. Selecting a candidate:
- autofills `name`, `starts_at`, `ends_at` from the chosen `meeting` row and disables those three fields (labeled "synced from Google Calendar") — editing them locally would just be overwritten by the next sync,
- stores the picked `gcal_event_id` for the POST.

Location and description remain free-text and admin-editable always — the calendar sync doesn't fetch those fields today, so we're not pretending to sync them.

Clearing the dropdown selection re-enables manual name/date/time entry and drops `gcal_event_id` from the submission.

## Server-side validation

`POST /api/admin/events` (and the edit route) accept an optional `gcalEventId`. When present, the server looks up the corresponding `meeting` row itself and derives `name`/`starts_at`/`ends_at` from it — client-supplied text for those fields is ignored when a link is present, so a tampered request can't desync the row from what the calendar actually says. If the `gcalEventId` doesn't match any `meeting` row, the request is rejected (400).

## Keeping it in sync

One added step in `syncCalendar()` (`src/lib/gcal.ts`), run after the existing `meeting` upsert/prune so the just-refreshed `meeting` table is authoritative for this pass:

1. Select `event` rows where `gcal_event_id is not null` and `ends_at >= now` (mirrors the sync's own rolling-window boundary — no point chasing events already over).
2. For each, look up `meeting` by `gcal_event_id`:
   - **Found**: update `event.name/starts_at/ends_at` if any differ from the `meeting` row, clear `gcal_missing` if it was set. No-op write skipped when nothing changed.
   - **Not found** (pruned by the sync, i.e. deleted upstream or now outside the calendar window): set `gcal_missing = true`. Leave the row's other fields untouched — this is a flag, not a delete.
3. Return an added count (e.g. `linkedEventsUpdated`) in `SyncResult` for observability, matching the existing `meetings`/`buildDays`/`backfilledPeriods` counters.

This runs on every existing sync (cron + manual trigger) — no new schedule, no new endpoint for the sync itself.

## Admin UI for flagged events

On `/admin/events/[id]`, when `gcal_missing` is true, show a banner: "Linked Google Calendar event was deleted — unlink or leave as-is," with an "Unlink" button that clears both `gcal_event_id` and `gcal_missing` (roster, signups, and the event row's own fields are untouched — it just becomes a normal manually-managed event again).

## Out of scope

- No new npm dependency (`googleapis`, etc.) — reuses the existing hand-rolled REST + JWT auth and the already-synced `meeting` table.
- No separate cron/endpoint for event-link sync — piggybacks on the existing calendar sync job.
- No field-level "admin override wins" tracking — calendar always wins for the fields it supplies (name/date/time), matching the existing `meeting` sync's own philosophy.
- No live Google Calendar fetch from the admin UI when picking a candidate — candidates come from the already-synced `meeting` table.
- Location/description are never derived from or overwritten by the calendar link.
