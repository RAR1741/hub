# Event Slack Channels — Design

**Date:** 2026-08-30
**Status:** Approved design, pre-implementation
**Builds on:** `docs/superpowers/specs/2026-08-27-slack-integration-design.md` (Slack core, linking, cron pattern)

## Problem & constraints

When an event is created, automatically create a dedicated **public** Slack
channel, invite the creator and signups, rename the channel when the event's
effective name changes, and archive it ~7 days after the event ends.

Confirmed decisions (not re-litigated here):

1. Public channels (scope `channels:manage`).
2. New events only — no backfill.
3. Unlinked people (no `person.slack_user_id`): skip the invite but **record**
   it so an admin can see who couldn't be added.
4. Channel create/rename/archive/invite happen **only** when
   `VERCEL_ENV === "production"`. Non-prod: logged no-op. (Messages already
   redirect to #bot-test in non-prod — `src/lib/slack.ts:44-59` — but channels
   can't be redirected, so channel ops are prod-gated.)

Repo constraints that shape the design:

- Slack ops must never block or fail the event/signup DB write (matches
  `slack.ts`'s never-throw convention, `src/lib/slack.ts:38-43`).
- Migrations: new file, never edit applied ones; new *columns* on
  already-granted tables need no GRANT (`supabase/migrations/20260827130000_person_slack_user_id.sql:2`).
- Cron = pg_cron + pg_net → secret-gated route
  (`supabase/migrations/20260827140000_slack_mentor_reminders_cron.sql`,
  `src/app/api/cron/slack/mentor-reminders/route.ts`). Not vercel.json.
- gcal-linked events take their effective name from the `meeting` row
  (`src/lib/events.ts:85-93` `resolveLinkedFields`), and the calendar sync
  *also* renames linked events outside `updateEvent`
  (`src/lib/gcal.ts:209-231` `syncLinkedEvents`).
- Public channels mean a missed invite is a convenience gap, not a lockout —
  anyone can self-join. This lowers the stakes for every invite edge case.

## Chosen approach

**Inline best-effort hooks for immediacy + a nightly cron as the reconciler.**
Create/invite/rename fire inline after the DB write succeeds; the nightly job
archives old channels, retries missed invites, and heals drifted names
(including renames made by the calendar sync). Everything converges even when
an inline Slack call fails.

### 1. Schema — one new migration `supabase/migrations/20260830120000_event_slack_channels.sql`

```sql
-- Channel identity lives on the event row: the id is authoritative (never
-- re-derived from the name); the stored name lets rename detection skip
-- no-op API calls; archived_at makes the nightly archive idempotent.
alter table event add column slack_channel_id text unique;
alter table event add column slack_channel_name text;
alter table event add column slack_archived_at timestamptz;

-- Null = not (yet) invited by us: doubles as the admin-visible record of
-- "couldn't be added" and the nightly sweep's retry marker.
alter table event_signup add column slack_invited_at timestamptz;

-- event/event_signup are already granted to service_role; new columns need
-- no grant (same note as 20260827130000_person_slack_user_id.sql).

insert into app_setting (key, value) values
  ('slack_event_channels_secret', '""'),
  ('slack_event_channels_url', '"http://host.docker.internal:3000/api/cron/slack/event-channels"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'slack-event-channels-nightly',
  '0 8 * * *',  -- 08:00 UTC = 3-4am ET
  $cron$ ... net.http_post(url/secret from app_setting, header x-sync-secret) ... $cron$
);
```

(The `$cron$` body is copied verbatim from
`20260827140000_slack_mentor_reminders_cron.sql:14-23` with the two keys
swapped.)

**Recording unlinked people — decision: no new table.** "Who couldn't be
added" is fully derivable: signups joined to `person` where
`slack_user_id is null` (plus `slack_invited_at is null` for
attempted-but-failed invites), and the creator via `event.created_by`.
Rejected alternatives:

- *New `event_slack_miss` table*: needs a service_role GRANT migration,
  duplicates derivable state, and drifts the moment a person gets linked or
  self-joins. More rows to keep honest, zero extra information.
- *`app_setting` blob (LinkReport-style)*: not per-event queryable; the
  existing `slack_last_sync_report` pattern fits a global sync run, not
  per-event membership.

`slack_invited_at` is the one bit that is NOT derivable (did the invite
actually land?), and it's exactly what the nightly retry sweep needs anyway.
One column does both jobs.

**Admin visibility:** extend `listEventRoster` (`src/lib/event-signups.ts:59`)
— add `slack_user_id` to the person embed and `slack_invited_at` to the signup
select — and surface a "not in Slack channel" badge per roster row on the
existing event roster page (signed-up + unlinked, or linked-but-uninvited).
The creator is covered per decision 3 even when they never sign up: the admin
event page shows an "event creator not in Slack" note derived from
`event.created_by` joined to `person.slack_user_id is null` (part of task 6).
The remedy for both is the existing Slack admin link page; the nightly sweep
or self-join then covers membership.

### 2. Slug derivation — pure function `channelSlug` in the new module

Slack channel names: lowercase, no spaces/periods, `[a-z0-9-_]`, max 80 chars,
must be workspace-unique (archived channels still reserve their names).

```
slug(name):
  s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if s == "": s = eventId.slice(0, 8)        // all-punctuation / non-ASCII name
  return "e-" + s

base(name)            = slug(name).slice(0, 80)
suffixed(name, id)    = slug(name).slice(0, 75) + "-" + id.slice(0, 4)   // = 80 max
```

- **Create:** try `base`; on `name_taken` retry once with `suffixed`; if that
  is also taken (near-impossible: same 75-char slug AND same 4 uuid hex
  chars), log and give up — event has no channel (see edge cases).
- **Rename:** recompute both candidates from the *effective* name. If the
  stored `slack_channel_name` equals **either** candidate → no-op (this is
  what stops a collision-suffixed channel from being "renamed" every night
  forever). Otherwise `conversations.rename` to `base`, retry `suffixed` on
  `name_taken`, store whichever succeeded.
- The uuid suffix is deterministic per event, so create and every future
  rename/reconcile converge on the same two candidate names.
- `name_taken` is **expected flow**, not an anomaly: archived channels keep
  their names, so next season's recurring "Kickoff" event collides with last
  year's archived `e-kickoff` by design and lands on `e-kickoff-a1b2`.

### 3. Slack channel operations — new module `src/lib/slack-channels.ts`

Sibling to `slack-link.ts`; every function takes `SlackDeps` (injected,
`slackDepsFromEnv()` at call sites) and follows `slack.ts`'s degradation
ladder, with one difference — **channel ops are prod-gated, not redirected**:

1. `!deps.token` → `console.log("[slack:no-token] would …")`, return null/false.
2. `!deps.isProd` → `console.log("[slack:dev] would create channel e-foo …")`,
   return null/false. (Decision 4.)
3. Real call via a small module-local `post()` helper (same shape as the
   private one in `slack.ts:25-36`; it isn't exported, so this module carries
   its own ~10-line copy rather than loosening `postChannelMessage`'s
   registry-typed signature — that compile-time guarantee stays intact).

API (all never-throw; failures logged):

```ts
channelSlug(name: string, eventId: string): { base: string; suffixed: string }  // PURE
createEventChannel(deps, name, eventId): Promise<{ id: string; name: string } | null>
renameChannel(deps, channelId, name, eventId): Promise<{ name: string } | null>
archiveChannel(deps, channelId): Promise<boolean>       // already_archived ⇒ true
inviteToChannel(deps, channelId, slackUserIds: string[]): Promise<boolean>
                                                        // already_in_channel ⇒ true
postToEventChannel(deps, channelId, text): Promise<boolean>
    // kickoff message; non-prod: unreachable (channel never exists), still
    // guarded by the same ladder for safety
```

Orchestrators (same module — they own the DB writes that record outcomes):

```ts
afterEventCreated(deps: {db, slack}, ev: { id, name, createdBy, startsAt, endsAt, location })
  // create channel → write slack_channel_id/name on event → invite creator if
  // linked → post one kickoff message (name, dates, location)
afterEventUpdated(deps, ev: { id, name, slackChannelId, slackChannelName, slackArchivedAt })
  // skip if no channel or archived; rename per §2; update stored name
afterEventSignup(deps, ev: { id, slackChannelId, slackArchivedAt }, personId)
  // skip if no channel/archived; look up person.slack_user_id; null ⇒ skip
  // (derived record covers it); else invite; on success set
  // event_signup.slack_invited_at
sweepEventChannels(deps): Promise<{ archived, invited, renamed, failed }>  // §5
```

### 4. Hook points — inside the lib functions, after the DB write

Hooks live in `src/lib/events.ts` / `src/lib/event-signups.ts` (not the
routes) so every caller gets the behavior. Each lib function gains an optional
`slack?: SlackDeps` param (default `slackDepsFromEnv()`), mirroring the
existing optional `db?`. Every hook is `await`ed inside its own
`try/catch(e){console.error(...)}` — awaited because fire-and-forget dies with
the serverless invocation; try/caught so Slack can never change the function's
result. **DB commit always precedes the Slack call.**

- `createEvent` (`src/lib/events.ts:95-120`): after the insert succeeds
  (L118), call `afterEventCreated` with `resolved.name` /
  `resolved.startsAt` / `resolved.endsAt` (the effective, possibly
  meeting-derived values — NOT the raw input, which `resolveLinkedFields`
  may have overridden) plus `input.location` (no resolved variant).
- `updateEvent` (`src/lib/events.ts:145-176`): extend the update's
  `.select("id")` (L172) to also return `slack_channel_id,
  slack_channel_name, slack_archived_at` (zero extra round trips), then call
  `afterEventUpdated` with `resolved.name`. Rename fires only when the stored
  name matches neither candidate (§2).
- `signUpForEvent` (`src/lib/event-signups.ts:9-24`): the function already
  fetched the event (L15); add the three slack columns to the `Event` type /
  `eventFromRow` (`src/lib/types.ts`) so they ride along. After the insert
  succeeds, call `afterEventSignup`. Signups after the event ended are
  already 409'd (L16), so no post-end invite path exists.
- `cancelEventSignup` (`src/lib/event-signups.ts:26-39`): **no Slack action.**
  Kicking from a public channel is hostile and pointless (they can rejoin),
  and `conversations.kick` may need extra scopes. Deleting the signup row
  drops its `slack_invited_at` with it, so a re-signup naturally re-invites
  (`already_in_channel` ⇒ treated as success).
- `deleteEvent` (`src/lib/events.ts:184-196`): extend the existing existence
  check (L189) to also select `slack_channel_id`; after a successful delete,
  best-effort `archiveChannel` — otherwise the channel is orphaned forever
  (the row holding its id is gone).

### 5. Nightly cron — route + sweep

**Route** `src/app/api/cron/slack/event-channels/route.ts`: byte-for-byte the
mentor-reminders shape (`src/app/api/cron/slack/mentor-reminders/route.ts:7-21`)
— `getSetting("slack_event_channels_secret")`, `secureEqual` on
`x-sync-secret`, empty secret fails closed, then
`sweepEventChannels({ db, slack: slackDepsFromEnv() })`, return the summary
JSON.

**`sweepEventChannels`** (idempotent; every step safe to re-run):

1. Load `event` where `slack_channel_id is not null and slack_archived_at is
   null` (NOT filtered on `ends_at >= now()` — a person linked after the
   event ends should still get invited during the 7-day window).
2. For each with `ends_at < now() - interval '7 days'`: `archiveChannel`; on
   success (incl. `already_archived`) set `slack_archived_at = now()`. Done
   with that event.
3. For the rest: rename-reconcile per §2. This is what heals renames made by
   the calendar sync (`src/lib/gcal.ts:209-231`) without touching gcal.ts.
4. Invite sweep: `event_signup` rows for the surviving events where
   `slack_invited_at is null`, joined to `person` where `slack_user_id is not
   null` → `inviteToChannel`, paced ~1.1s/call (mentor-reminders' sleep
   pattern, `src/lib/mentor-reminders.ts:74`), set `slack_invited_at` on
   success/`already_in_channel`. Still-unlinked signups stay null — that IS
   the admin record.

**Prod config note (PR description + docs):** like every pg_cron job here, the
seeded url/secret are dev defaults; prod needs
`slack_event_channels_url` = the prod route URL and a real
`slack_event_channels_secret` set in `app_setting`, or the job silently
no-ops (same failure mode as first-sync — see memory/dev-notes).

### 6. Config & scopes

- **New bot scope: `channels:manage`** (covers `conversations.create/rename/
  archive/invite` for public channels; exact scope names verified against
  Slack docs at implementation time, per the 2026-08-27 spec's convention).
  `chat:write` (already granted) covers the kickoff message — the bot is a
  member of channels it creates.
- **Both Slack apps (hub + hub-dev) need the manifest updated and
  reinstalling** — reinstall regenerates nothing but must be accepted by an
  admin. hub-dev never creates channels (prod gate) but the manifests stay
  identical by convention. Update `slack/manifest.yml` if present in-repo.
- New `app_setting` rows: `slack_event_channels_secret`,
  `slack_event_channels_url` (seeded by the migration, overridden in prod).
- No new env vars. **Add `SLACK_BOT_TOKEN` to `.env.example`** (consumed by
  `slackTokenFromEnv()`, `src/lib/slack.ts:12-14`, but currently
  undocumented there): unset ⇒ all Slack ops are logged no-ops.

### 7. Edge cases

| Case | Behavior |
| --- | --- |
| Rename while channel archived | `afterEventUpdated`/sweep skip archived channels outright (`slack_archived_at` set); a raced `is_archived` API error is logged and skipped. Stored name may go stale on an archived channel — harmless. |
| Event deleted | Delete succeeds first, then best-effort archive (§4); archive failure logs and is otherwise ignored (orphaned live channel is the cost of a Slack outage at delete time — rare, manually archivable). |
| Duplicate event names / next season's recurring event vs archived `e-kickoff` | `name_taken` → deterministic uuid suffix (§2). Expected flow. |
| Signup after event ended | Can't happen — 409 upstream (`src/lib/event-signups.ts:16`). |
| Person left the channel, still signed up | `slack_invited_at` already set ⇒ sweep won't re-invite. Public channel ⇒ they can rejoin. Deliberate: leaving is a user choice we don't fight. |
| Invite rate limits / partial sweep failure | Inline invites are single calls; sweep paces ~1/sec. A failed invite leaves `slack_invited_at` null ⇒ retried next night, and visible to admins meanwhile. |
| Slack outage at event creation | Channel never created (`slack_channel_id` stays null); logged. The sweep does NOT create channels retroactively — a null id is indistinguishable from pre-feature/non-prod events, and decision 2 forbids backfill. ponytail: acceptable ceiling; if it bites, a later `slack_channel_pending` flag enables retry. |
| gcal-linked events | Channel name always tracks the *effective* name: `createEvent`/`updateEvent` pass `resolved.name` (`src/lib/events.ts:101,151`); calendar-sync renames (`gcal.ts:209-231`) heal via the nightly reconcile — see Alternatives for the immediacy trade-off. |
| Unlinked person linked later | Nightly sweep invites them (no `ends_at` filter, §5.1) until the channel archives. |
| Event name of all punctuation / emoji | Slug falls back to `e-<uuid8>` (§2). |

## Alternatives considered

- **Hook the calendar sync (`syncLinkedEvents`) for instant renames** instead
  of cron-reconcile-only. Cost of chosen design: a calendar-title rename
  leaves the channel name up to ~24h stale. Rejected for v1 — one fewer
  touched file, and the reconciler must exist anyway (it also heals failed
  inline renames). Overrule with a 5-line hook in `gcal.ts:227-229` if 24h
  staleness matters.
- **New table for unlinked-invite records** / **`app_setting` report blob** —
  rejected in §1: derivable state + one timestamp column wins.
- **Kick on signup cancel** — rejected (§4): hostile, rejoinable, extra scope
  risk.
- **`waitUntil`/fire-and-forget for Slack calls** — rejected: not reliably
  available across this repo's Next version and test harness; a ~200-400ms
  awaited call inside admin/signup mutations is acceptable and boring.
- **Membership diff against `conversations.members`** for perfect sync —
  rejected: more scopes/API traffic to solve a problem self-join already
  solves for public channels.

## Trade-offs & risks

- Event create/update/signup latency grows by 1-3 awaited Slack calls in prod.
  Acceptable for these low-frequency mutations; all failure modes degrade to
  "no channel action + log".
- `slack_channel_name` is a cache of Slack state; a manual rename in Slack
  will be "healed" (renamed back) by the nightly reconcile. Document: rename
  the *event*, not the channel.
- Channel creation failure is not retried (see edge cases) — logged ceiling.
- The prod gate means the create/rename/archive/invite paths get **zero
  real-API exercise before prod**. Mitigation: unit tests with mocked fetch
  assert exact request payloads; the non-prod log lines ("would create …")
  make dev verification observable; first prod event gets a manual smoke check.

## Implementation outline (ordered task breakdown)

1. **coder** — Migration `20260830120000_event_slack_channels.sql`: three
   `event` columns, `event_signup.slack_invited_at`, two `app_setting` seeds,
   pg_cron job (§1, §5). Verify with `./dev npm run db:reset`.
2. **coder** — `src/lib/slack-channels.ts` API wrappers: local `post()`,
   `channelSlug` (pure), `createEventChannel`, `renameChannel`,
   `archiveChannel`, `inviteToChannel`, `postToEventChannel`, with the
   no-token/non-prod ladder + unit tests (mocked fetch: slug cases incl.
   truncation lengths 80/75+5, `name_taken` retry, `already_in_channel`/
   `already_archived` as success, prod gate, no-token no-op).
3. **coder** — Orchestrators in the same module: `afterEventCreated`,
   `afterEventUpdated` (candidate-pair rename logic), `afterEventSignup`,
   `sweepEventChannels` + unit tests (mock db + fetch; sweep idempotency).
4. **coder** — Hook wiring: `src/lib/types.ts` Event slack fields;
   `createEvent`/`updateEvent`/`deleteEvent` (`src/lib/events.ts`) and
   `signUpForEvent` (`src/lib/event-signups.ts`) per §4; tests asserting a
   throwing Slack dep never changes the DB result.
5. **coder** — Cron route `src/app/api/cron/slack/event-channels/route.ts`
   (mentor-reminders clone) + route test (403 on bad/empty secret).
6. **coder** — Admin visibility: `listEventRoster` slack fields + roster
   badge (§1) + test.
7. **mechanic** — `.env.example`: add `SLACK_BOT_TOKEN` block; add
   `channels:manage` to `slack/manifest.yml` if the file exists.
8. **coder** — Full verification (`./dev npm run lint / typecheck / test /
   e2e`), then PR. PR body must carry the prod checklist: reinstall both
   Slack apps with the new scope; set `slack_event_channels_url`/`_secret` in
   prod `app_setting`; `supabase db push`; smoke-test the first prod event.
