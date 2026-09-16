# Event + meeting reminder notifications — design spec

**Date:** 2026-09-10
**Status:** proposed (gate review pending)
**Branch:** `event-reminder-notifications`

> Path note: the orchestrator asked for this file at `docs/superpowers/`; other specs live
> under `docs/superpowers/specs/`. Move it there when the plan lands if you care.

## Summary

Let a person opt into push reminders **15 / 30 / 60 / 120 minutes** before (a) each event they
sign up for, chosen per signup, and (b) every team meeting, chosen once globally. A single new
pg_cron job sweeps every 5 minutes and replaces today's fixed team-wide 3-hour meeting reminder.

Every reminder fires at most once per `(person, target, offset)`. Dedupe is a DB column on the
target, not app-side bookkeeping.

## Fixed decisions (from the user, not up for redesign)

| # | Decision |
| --- | --- |
| 1 | Offsets are exactly `{15, 30, 60, 120}` minutes. |
| 2 | Sweep on a NEW pg_cron at `*/5 * * * *`. Hourly cadence is gone. |
| 3 | A person may stack several offsets → store a set. |
| 4 | Events: offset set stored **per signup**. Meetings: one **global per-person** set; it replaces the fixed 3h team-wide reminder; existing opted-in users default to `{60}`. |

## Judgment calls for the gate (flagged `[GATE]`)

| # | Call | Recommendation | Alternative |
| --- | --- | --- | --- |
| G1 | Meeting dedupe granularity | Stamp `(meeting, offset)` on the meeting row, **not** per person. Whether offset `m` is due depends only on `(starts_at, now)`, so everyone who chose `m` fires in the same tick. Person who adds an offset *after* its fire time for an imminent meeting misses it — acceptable. | Child table `meeting_reminder_sent(meeting_id, person_id, minutes)` — exact but strictly more objects for no user-visible gain. |
| G2 | Events notification type | **No new type.** Picking a lead time on the signup *is* the opt-in. Widen `sendPushToOptedIn(type: NotificationType \| null)`; `null` skips the `notification_types` check (keeps `is_active` + subscription). Avoids "I picked 15 min and got nothing because a hidden toggle was off". | Add `event_reminder` to the union (META, "six types" test, prefs toggle, docs table) and require it on. |
| G3 | No push device UX | Static muted line under every picker: "Sent as a push notification to devices enabled in [Notifications](/me/notifications)." No per-card `push_subscription` lookup. | Query subscriptions and hide the picker when none — extra read per card for a one-line hint. |
| G4 | Signup + reminders atomicity | Two writes (signup, then `event_signup_reminder` rows). On reminder-insert failure: `console.error`, still return 201 — the signup is the primary outcome. | Add `p_reminder_minutes int[]` to `submit_event_signup` RPC. Warning: `create or replace` with a new arity creates an **overload**; PostgREST then throws PGRST203 (ambiguous). Must `drop function submit_event_signup(uuid,uuid,uuid,jsonb)` first. Also doesn't cover the non-form path without a second RPC. Not worth it. |
| G5 | `push_reminders_url` seed | Derive from existing `push_meeting_reminder_url` via `replace(..., '/meeting-reminder', '/reminders')` so prod inherits its host with zero manual steps; docker default as fallback; delete the old key. | Seed docker default only and hand-set prod (runbook step). |
| G6 | One vs two cron jobs/routes | **One** job `push-reminders` → one route `POST /api/cron/push/reminders` calling both sweeps. Same secret, same cadence, same window math. | Two jobs/routes — twice the boilerplate, no isolation benefit (each sweep already never throws). |
| G7 | Picker density on `/events` | On the one-click path every upcoming event card grows a 4-checkbox fieldset + hint. Rung-4 fix: wrap the picker in native `<details><summary>Remind me</summary>…</details>`, collapsed by default — zero JS, cards look as today, e2e selectors unaffected. Cost: lower discoverability. **Not decided here — gate picks.** | Always-open picker (simplest, noisiest). |

## Skipped (YAGNI — add when asked)

- Editing reminders after signup (cancel + re-signup covers it).
- Showing chosen reminders on event cards.
- Resetting `event_signup_reminder.pushed_at` when an event's `starts_at` moves (one `update … set pushed_at = null where event_id = …` in `updateEvent` if wanted later; meetings *do* reset via existing `notifyMeetingChanged`).
- `meeting_reminder` on + empty lead-time set = silently nothing. Fine; the UI makes it visible.

---

## 1. Data model

Migration file: `supabase/migrations/20260910120000_reminder_offsets.sql`
(origin/master tops out at `20260909130000_battery_kinds.sql` — verify before commit per
`project-hub-migration-version-collision`.)

```sql
-- 20260910120000_reminder_offsets.sql
-- Per-signup event reminders + per-person global meeting reminder lead times.
-- Replaces the fixed 3h team-wide meeting reminder (reminder_pushed_at).

-- (a) Events: one row per (signup, offset). The row IS the choice and the
-- dedupe marker (pushed_at). Composite FK → event_signup so cancel cascades.
create table event_signup_reminder (
  event_id  uuid not null,
  person_id uuid not null,
  minutes   int  not null,
  pushed_at timestamptz,
  primary key (event_id, person_id, minutes),
  constraint event_signup_reminder_minutes_check check (minutes in (15, 30, 60, 120)),
  constraint event_signup_reminder_signup_fk
    foreign key (event_id, person_id)
    references event_signup (event_id, person_id) on delete cascade
);
-- Sweep reads "unpushed rows for events in window".
create index event_signup_reminder_pending_idx
  on event_signup_reminder (event_id) where pushed_at is null;

alter table event_signup_reminder enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on event_signup_reminder to service_role;

-- (b) Meetings: one global set per person. Default {60} backfills every
-- existing row, so currently opted-in people keep getting a reminder.
alter table person add column meeting_reminder_minutes int[] not null default '{60}'
  constraint person_meeting_reminder_minutes_check
  check (meeting_reminder_minutes <@ array[15, 30, 60, 120]);

-- (c) Meeting dedupe: which offsets have already fired for this meeting.
-- Due-ness of an offset depends only on (starts_at, now), so one stamp per
-- (meeting, offset) is exactly-once for every (person, meeting, offset).
alter table meeting drop column reminder_pushed_at;
alter table meeting add column reminder_pushed_minutes int[] not null default '{}';
```

### Why child table for events, array for meetings

| | Events | Meetings |
| --- | --- | --- |
| Per-row state? | Yes — `pushed_at` per `(signup, offset)`. | No — set is read/written whole, ≤4 values. |
| Lifecycle | Must die with the signup → composite FK cascade (same trick as `form_response`). | Lives with the person. |
| Query shape | "unpushed rows for these events" → partial index. | `.overlaps()` on recipients — index-free is fine at team scale (~100 rows). |
| Choice | **Table** | **`int[]` + CHECK `<@`** |

An `int[]` on `event_signup` plus a separate `event_reminder_sent` table would be two objects
with a join instead of one; rejected.

### PostgREST caveat (coder must know)

`event_signup_reminder` has **no direct FK** to `event` or `person`, so PostgREST **cannot
embed** `event(...)` from it. The sweep loads in-window events first, then
`.in("event_id", ids)`. Do not try `select("*, event(starts_at)")` — it returns an error, and an
unchecked one would look like "no reminders due".

### Dedupe strategy — "fire each (person, target, offset) exactly once"

- **Events:** row `pushed_at is null` ⇒ pending. Sweep sends, then
  `update … set pushed_at = now() where event_id = ? and minutes in (dueM) and pushed_at is null`.
  Two ticks racing could double-send in theory; in practice `net.http_post` is fire-and-forget
  so the cron job returns instantly, and two Next.js handlers overlap only if one runs >5 min.
  Accepted (`ponytail:` comment).
- **Meetings:** `reminder_pushed_minutes` contains every offset already fired. Sweep sends to
  `person.meeting_reminder_minutes && dueM`, then stamps `reminder_pushed_minutes ∪ dueM`.
  `notifyMeetingChanged` resets to `'{}'` when a meeting moves (already the reset point today).

### Migration retiring the old cron

Second file: `supabase/migrations/20260910120100_push_reminders_cron.sql` — see §7.

---

## 2. Canonical offset set

**Representation:** sorted ascending, deduped `number[]` drawn from `{15, 30, 60, 120}`. Empty
array = "no reminders". Same shape on the wire (JSON), in Postgres (`int[]` / rows), and in TS.

**Shared constant** — new file `src/lib/reminder-minutes.ts` (pure, no server imports; client
components import it):

```ts
export const REMINDER_MINUTES = [15, 30, 60, 120] as const;
export type ReminderMinutes = (typeof REMINDER_MINUTES)[number];
export const REMINDER_LABELS: Record<ReminderMinutes, string> = {
  15: "15 min", 30: "30 min", 60: "1 hour", 120: "2 hours",
};
/** Max lead time; the sweep window. */
export const MAX_REMINDER_MS = 120 * 60_000;

/** undefined/null → [] (field omitted). Non-array or any bad member → null (400).
 *  Dedupes and sorts. */
export function parseReminderMinutes(v: unknown): ReminderMinutes[] | null;

/** Offsets that are due for a target starting at `startsAtMs` as of `nowMs`,
 *  excluding those already pushed. Due ⇔ startsAtMs - m*60_000 <= nowMs. */
export function dueOffsets(startsAtMs: number, nowMs: number, exclude: readonly number[]): ReminderMinutes[];
```

**Validation lives in:**
1. DB CHECK constraints (source of truth; rejects anything the app misses).
2. `parseReminderMinutes` at every route boundary (signup POST, prefs PATCH) → 400 on `null`.
3. Nowhere else. Libs trust their callers (typed `ReminderMinutes[]`).

---

## 3. Notification types & opt-in

| Target | Type gate | Lead-time source | Net effect |
| --- | --- | --- | --- |
| Meeting | `meeting_reminder` (existing; master switch on `/me/notifications`) | `person.meeting_reminder_minutes` (global) | Push iff type on AND offset chosen AND device subscribed. |
| Event | **none** `[GATE G2]` | `event_signup_reminder` rows (per signup) | Push iff offset chosen on signup AND device subscribed. |

`src/lib/notification-types.ts` changes: only the `meeting_reminder` META description →
`"A reminder before each meeting starts — pick how far ahead below."`. Union unchanged (six
types; existing test still passes).

`src/lib/push-dispatch.ts` change: `type: NotificationType | null`. In the filter at L119:
`person?.is_active && (type === null || person.notification_types.includes(type))`. Log line
uses `type ?? "untyped"`. Backward-compatible for all existing callers.

**Offsets but no push device:** nothing is sent (`sendPushToOptedIn` finds no subscriptions).
UI shows the static hint from G3. No email/Slack fallback.

---

## 4. Sweep libs

Both run inside one 5-minute tick. Window: targets with `starts_at ∈ [now, now + 120 min]`.
Past targets drop out naturally — nothing to stamp for missed ones.

**Collapse rule (both sweeps):** per target compute `dueM = dueOffsets(startsAt, now, alreadyPushed)`.
If empty → skip. Else send **one** push per recipient who chose any `m ∈ dueM`, then stamp
**all** of `dueM`. This is what keeps a meeting moved earlier (or a cron outage) from firing
2–3 pushes in one tick. Copy uses **absolute time** ("Starts at 6:30 PM"), never "in 15 min",
because catch-up ticks make relative text wrong.

Time formatting: reuse the existing one-liner from today's `meeting-reminder.ts`
(`toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis", hour: "numeric", minute: "2-digit" })`)
inline in each lib. Two call sites, one line each — not worth a helper.

### 4a. `src/lib/event-reminder.ts` (new)

```ts
export async function pushEventReminders(deps: {
  db: SupabaseClient; push?: PushDeps; nowIso?: string;
}): Promise<{ sent: number; pruned: number; events: number }>;
```

Queries (check `.error` on each; on error log + return zeros):

1. `db.from("event").select("id, name, starts_at").gte("starts_at", nowIso).lte("starts_at", untilIso)`
   where `until = now + MAX_REMINDER_MS`. Zero rows → return.
2. `db.from("event_signup_reminder").select("event_id, person_id, minutes").in("event_id", ids).is("pushed_at", null)`.
3. Per event: `dueM = dueOffsets(startsAt, now, [])` (exclusion is already the `pushed_at is null` filter).
   `recipients = distinct person_id where minutes ∈ dueM`. Skip if empty.
   `sendPushToOptedIn(recipients, null, { title: \`${event.name}\`, body: \`Starts at ${when}\`, url: \`/events/${event.id}\` }, { db, push })`.
4. `db.from("event_signup_reminder").update({ pushed_at: nowIso }).eq("event_id", id).in("minutes", dueM).is("pushed_at", null)`
   — stamps every due offset for every signup on that event, including people whose only device
   was pruned (they chose it; it "fired").

`events` in the result = number of events that got at least one push.

### 4b. `src/lib/meeting-reminder.ts` (rewrite in place, same export name)

```ts
export async function pushMeetingReminders(deps: {
  db: SupabaseClient; push?: PushDeps; nowIso?: string;
}): Promise<{ sent: number; pruned: number; meetings: number }>;
```

1. `db.from("meeting").select("id, title, starts_at, reminder_pushed_minutes").gte("starts_at", nowIso).lte("starts_at", untilIso)`.
2. Per meeting: `dueM = dueOffsets(startsAt, now, m.reminder_pushed_minutes)`. Skip if empty.
3. `db.from("person").select("id").overlaps("meeting_reminder_minutes", dueM)` → ids
   (`is_active` is already filtered inside `sendPushToOptedIn`). Skip the send if empty but
   still stamp — nobody wanted it, don't re-evaluate next tick.
4. `sendPushToOptedIn(ids, "meeting_reminder", { title: \`Meeting at ${when}\`, body: m.title || "Team meeting", url: "/calendar" }, { db, push })`.
5. `db.from("meeting").update({ reminder_pushed_minutes: [...new Set([...m.reminder_pushed_minutes, ...dueM])].sort((a,b)=>a-b) }).eq("id", m.id)`.

`LEAD_MS` constant and `.is("reminder_pushed_at", null)` filter are deleted.

### 4c. `src/lib/meetings.ts`

`notifyMeetingChanged` L~97: `.update({ reminder_pushed_at: null })` → `.update({ reminder_pushed_minutes: [] })`.
One site; covers both callers (`updateMeeting`, `src/lib/gcal.ts:315`).

---

## 5. Routes

### 5a. Cron route — `src/app/api/cron/push/reminders/route.ts` (new)

Copy `src/app/api/cron/push/meeting-reminder/route.ts` verbatim, then:

```ts
export async function POST(request: Request) {
  // secret check unchanged: x-sync-secret vs getSetting("push_cron_secret"), secureEqual, 403
  try {
    const push = pushDepsFromEnv();
    const [events, meetings] = await Promise.all([
      pushEventReminders({ db, push }),
      pushMeetingReminders({ db, push }),
    ]);
    return NextResponse.json({ ok: true, events, meetings });
  } catch (err) { /* 502 as today */ }
}
```

Delete `src/app/api/cron/push/meeting-reminder/route.ts` (+ its test). In
`src/app/route-auth-allowlist.test.ts`, replace the `api/cron/push/meeting-reminder/route.ts`
entry with `api/cron/push/reminders/route.ts`, same reason text. Both edits in the **same
commit** — a listed-but-missing route fails the allowlist test.

### 5b. Signup route — `src/app/api/events/[id]/signup/route.ts` (POST)

Body becomes `{ reminderMinutes?: number[] }` (one-click) or `{ answers, reminderMinutes?: number[] }` (form).

- One-click path today sends **no body**; parsing must tolerate empty/absent body → `[]`.
  Pattern: `const body = await request.json().catch(() => ({}))`, then
  `const minutes = parseReminderMinutes(body?.reminderMinutes)`; `null` → 400 `{ error: "invalid reminderMinutes" }`.
- Pass `minutes` to `signUpForEvent(...)` / `submitEventSignupResponse(...)`.
- Allowlist entry unchanged (route still `getViewer()`-gated and self-scoped).

### 5c. Signup libs

`src/lib/event-signups.ts`:

```ts
/** Insert reminder rows for a signup. Never throws; logs + returns false on error. */
export async function insertSignupReminders(
  db: SupabaseClient, eventId: string, personId: string, minutes: readonly ReminderMinutes[],
): Promise<boolean>;   // no-op true when minutes is empty

export async function signUpForEvent(
  eventId: string, personId: string, db?: SupabaseClient, slack?: SlackDeps,
  reminderMinutes: readonly ReminderMinutes[] = [],
): Promise<{ ok: boolean; status: number }>;
```

`signUpForEvent`: after the successful `event_signup` insert and before the Slack try/catch,
`await insertSignupReminders(client, eventId, personId, reminderMinutes)`. `[GATE G4]`

`src/lib/form-responses.ts`:

```ts
export async function submitEventSignupResponse(
  eventId, personId, formId, submitted, db?, form?,
  reminderMinutes: readonly ReminderMinutes[] = [],
)
```

After the RPC succeeds, same `insertSignupReminders` call. RPC signature untouched.

`cancelEventSignup`: no change — FK cascade removes reminder rows.

### 5d. Prefs route — `src/app/api/notifications/prefs/route.ts` (PATCH, existing `withRole("student")`)

Extend `prefsHandler` body: `{ type, enabled }` **or** `{ meetingReminderMinutes: number[] }`.

```ts
if ("meetingReminderMinutes" in body) {
  const minutes = parseReminderMinutes(body.meetingReminderMinutes);
  if (!minutes) return 400;
  const { error } = await db.from("person").update({ meeting_reminder_minutes: minutes }).eq("id", viewer.person.id);
  ...return 200 { ok: true, meetingReminderMinutes: minutes }
}
```

Existing `{type, enabled}` branch unchanged. No allowlist change (already `withRole`).

### 5e. Types — `src/lib/types.ts`

`PersonRow.meeting_reminder_minutes?: number[] | null`; `Person.meeting_reminder_minutes: number[]`;
`personFromRow` maps with `?? []`. `viewer.ts`/`people.ts` use `select("*")` so the column flows
through with no query edits.

---

## 6. UI

New shared client component `src/components/ReminderPicker.tsx`:

```tsx
export function ReminderPicker(props: {
  value: number[]; onChange: (v: number[]) => void;
  legend?: string; testIdPrefix?: string; disabled?: boolean;
})
```

Renders a `<fieldset className="signup-q">` with `<legend className="q-label">` and four
`<label className="signup-opt"><input type="checkbox" …/> {label}</label>` — same classes the
signup modal already uses so it inherits styling. Followed by the G3 muted hint
(`<p className="text-xs text-muted">…<a href="/me/notifications">Notifications</a></p>`; use
whatever muted-text class `NotificationSettings.tsx` already uses). `data-testid={\`${prefix}-${m}\`}`
on each input.

| Surface | Change |
| --- | --- |
| `EventSignupButton.tsx` (one-click) | When `!signedUp`: wrap in `flex flex-col gap-2`; `<ReminderPicker legend="Remind me before it starts (optional)" testIdPrefix="event-remind" …/>` above the existing button; POST body `JSON.stringify({ reminderMinutes })` with `Content-Type: application/json`. Button text/classes unchanged (e2e depends on "Sign up"/"Cancel sign-up"). |
| `EventSignupForm.tsx` (modal) | Add the same `ReminderPicker` as a final `signup-q` fieldset after the form fields; include `reminderMinutes` in the POST JSON. Checkbox inputs do not collide with e2e's single `getByRole("textbox")` or `getByRole("radio", {name:"Yes"})`. |
| `me/notifications/page.tsx` | Pass `meetingReminderMinutes={viewer.person.meeting_reminder_minutes}` to `NotificationSettings`. |
| `NotificationSettings.tsx` | Under the `meeting_reminder` row, when its checkbox is enabled, render `<ReminderPicker legend="How far ahead" testIdPrefix="lead" …/>`; on change PATCH `{ meetingReminderMinutes }` with the same optimistic-revert pattern the type toggles use. Keep `data-testid="toggle-meeting_reminder"`. |

`src/app/events/page.tsx` / `events/[id]/page.tsx`: no change (they already choose Form vs Button).

---

## 7. pg_cron migration

`supabase/migrations/20260910120100_push_reminders_cron.sql`:

```sql
-- 20260910120100_push_reminders_cron.sql
-- Every-5-min reminder sweep (events + meetings) replacing the hourly
-- push-meeting-reminder job. Reuses push_cron_secret.
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-meeting-reminder') then
    perform cron.unschedule('push-meeting-reminder');
  end if;
  if exists (select 1 from cron.job where jobname = 'push-reminders') then
    perform cron.unschedule('push-reminders');   -- re-run safety
  end if;
end $$;

-- [GATE G5] Inherit the deployed host from the old URL so prod needs no manual step.
insert into app_setting (key, value)
select 'push_reminders_url',
       to_jsonb(replace(value #>> '{}', '/api/cron/push/meeting-reminder', '/api/cron/push/reminders'))
  from app_setting where key = 'push_meeting_reminder_url'
on conflict (key) do nothing;
-- Fresh DB fallback.
insert into app_setting (key, value) values
  ('push_reminders_url', '"http://host.docker.internal:3000/api/cron/push/reminders"')
on conflict (key) do nothing;
delete from app_setting where key = 'push_meeting_reminder_url';

select cron.schedule(
  'push-reminders',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'push_reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'push_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

`/admin/cron` lists jobs via the `list_cron_jobs` RPC — nothing hardcoded to update.

**Deploy-order window:** the Supabase integration applies migrations on merge, before Vercel
finishes building. For ~a minute the old code may reference the dropped `reminder_pushed_at`
(only in `notifyMeetingChanged`'s unchecked update, and the old hourly sweep which is now
unscheduled). Harmless.

---

## 8. Alternatives considered

| Alternative | Why not |
| --- | --- |
| `event_signup.reminder_minutes int[]` + `event_reminder_sent` table | Two objects + a join to express what one table with `pushed_at` expresses. |
| Per-person `meeting_reminder_sent` table | Correct but strictly more objects; the `(meeting, offset)` stamp is exactly-once already (G1). |
| New `event_reminder` notification type | Second hidden opt-in creates a "chose 15 min, got nothing" path (G2). |
| Extend `submit_event_signup` RPC for atomicity | Overload/PGRST203 trap, still leaves the one-click path non-atomic (G4). |
| Two crons/routes | Double boilerplate, no isolation gain (G6). |
| Keep hourly cron + compute "fires in the next hour" | Violates fixed decision #2; 15-min offset impossible at hourly cadence. |
| Relative copy ("in 15 minutes") | Wrong on catch-up ticks; absolute time is always right. |

## 9. Trade-offs & risks

- **Late joiners miss already-fired offsets** (event signup 10 min before start with 15-min
  pick → nothing; meeting offset added after fire time → nothing). Acceptable; the alternative
  is an "immediately fire everything already past" rule that spams at signup time.
- **Non-atomic signup + reminders** (G4): a failed reminder insert leaves a signup with no
  reminders and no user feedback beyond a server log. Rare (FK/CHECK are the only failure
  modes, and both are pre-validated).
- **`sendPushToOptedIn(null)` widens the API.** Every existing caller still passes a type;
  only the event sweep uses `null`. Document in the JSDoc.
- **Event stamping when no device**: a person with reminders but no subscription gets rows
  stamped `pushed_at` anyway. That's correct ("would have fired") and keeps the pending index small.
- **Moving an event's start** does not reset event reminders (YAGNI). Meetings do reset.
- **Tick granularity**: `due ⇔ starts_at − m ≤ now` on a 5-min tick means a 15-min pick
  arrives somewhere in `(10, 15]` minutes before — up to one tick **late**, never early. Copy
  uses absolute time so this is invisible. If the gate prefers erring early (`[15, 20)`), the
  test becomes `starts_at − m ≤ now + TICK_MS`; state the choice in `dueOffsets`'s doc comment.
  Recommendation: keep late — it is the natural "due" semantic and needs no extra constant.
- **Send-time DB error consumes the offset**: `sendPushToOptedIn` returns `{0,0}` on a
  subscription-load error and the sweep stamps anyway. Same as today's meeting sweep;
  pre-existing behavior, not new risk.

## 10. Implementation outline (ordered, TDD)

Each `[coder]` task: write the test first, watch it fail, implement, commit, push.
`[mechanic]` tasks are fully specified edits. Run `./dev npm run test` (full suite — the
allowlist test only fails in the full run) before every commit that touches routes.

| # | Who | Task | Files | Test file |
| --- | --- | --- | --- | --- |
| 1 | mechanic | Migrations from §1 and §7 verbatim. Confirm no version collision against `origin/master`. | `supabase/migrations/20260910120000_reminder_offsets.sql`, `supabase/migrations/20260910120100_push_reminders_cron.sql` | `./dev npm run db:reset` applies cleanly |
| 2 | coder | Shared constant + `parseReminderMinutes` + `dueOffsets`. Cases: undefined→[], `[60,15,15]`→[15,60], `[45]`→null, `"60"`→null; `dueOffsets` at exactly `startsAt-15m` includes 15, excludes already-pushed, returns [] when all pushed. | `src/lib/reminder-minutes.ts` | `src/lib/reminder-minutes.test.ts` |
| 3 | coder | `sendPushToOptedIn` accepts `type: null` (skips type filter, keeps `is_active`). Update META description for `meeting_reminder`. | `src/lib/push-dispatch.ts`, `src/lib/notification-types.ts` | `src/lib/push-dispatch.test.ts` (+1 case), `notification-types.test.ts` unchanged |
| 4 | coder | Types: `meeting_reminder_minutes` on `PersonRow`/`Person`/`personFromRow`. | `src/lib/types.ts` | `src/lib/types.test.ts` (if exists) / `src/lib/people.test.ts:92` row gains `meeting_reminder_minutes: [60]` |
| 5 | coder | `insertSignupReminders` + `signUpForEvent(…, reminderMinutes)`. Fake DB in the test currently throws on unknown tables — add `event_signup_reminder` to the fake. Cases: empty → no insert; `[15,60]` → two rows; insert error → logged, signup still 201. | `src/lib/event-signups.ts` | `src/lib/event-signups.test.ts` |
| 6 | coder | `submitEventSignupResponse(…, reminderMinutes)` calls `insertSignupReminders` after RPC success only. | `src/lib/form-responses.ts` | `src/lib/form-responses.test.ts` |
| 7 | coder | Signup route parses body (absent body → `[]`, bad → 400) and threads `minutes` to both libs. | `src/app/api/events/[id]/signup/route.ts` | `src/app/api/events/[id]/signup/route.test.ts` |
| 8 | coder | Prefs route accepts `{ meetingReminderMinutes }`; 400 on invalid; existing `{type,enabled}` tests untouched. | `src/app/api/notifications/prefs/route.ts` | `src/app/api/notifications/prefs/route.test.ts` |
| 9 | coder | `pushEventReminders` sweep per §4a (window, collapse rule, one push per recipient, stamp all dueM, `.error` checks, absolute-time copy). | `src/lib/event-reminder.ts` | `src/lib/event-reminder.test.ts` (mock `./push-dispatch` like the existing meeting test) |
| 10 | coder | Rewrite `pushMeetingReminders` per §4b; change `notifyMeetingChanged` reset to `{ reminder_pushed_minutes: [] }`. | `src/lib/meeting-reminder.ts`, `src/lib/meetings.ts` | rewrite `src/lib/meeting-reminder.test.ts` (fake chain `select→gte→lte`, `person.select→eq→overlaps`, `update→eq`); `src/lib/meetings.test.ts:145` expectation |
| 11 | coder | New cron route calling both sweeps; delete old route + test; swap allowlist entry. **One commit.** | `src/app/api/cron/push/reminders/route.ts`, delete `src/app/api/cron/push/meeting-reminder/`, `src/app/route-auth-allowlist.test.ts` | `src/app/api/cron/push/reminders/route.test.ts` (403 missing/wrong/empty secret, 200 shape `{ok, events, meetings}`, 502 on throw — mirror `api/cron/slack/event-channels/route.test.ts`) |
| 12 | coder | `ReminderPicker` component; wire into `EventSignupButton` (JSON body) and `EventSignupForm`. | `src/components/ReminderPicker.tsx`, `src/components/EventSignupButton.tsx`, `src/components/EventSignupForm.tsx` | component tests if the repo has any for these (`*.test.tsx`); otherwise covered by e2e in #14 |
| 13 | coder | Prefs page: pass `meeting_reminder_minutes`; `NotificationSettings` renders lead-time picker under `meeting_reminder` when enabled, PATCHes on change. | `src/app/me/notifications/page.tsx`, `src/app/me/notifications/NotificationSettings.tsx` | existing test file for `NotificationSettings` if present |
| 14 | coder | e2e: extend `e2e/notifications.spec.ts` — toggle `meeting_reminder` on, tick `lead-15`, reload, assert checked. Optionally extend `e2e/event-signup-forms.spec.ts` to tick `event-remind-30` before "Sign up" and assert the row via the roster or a follow-up API read. Existing selectors must keep passing. | `e2e/notifications.spec.ts`, `e2e/event-signup-forms.spec.ts` | — |
| 15 | mechanic | Docs: `docs/features/push-notifications.md` (type table row for `meeting_reminder`; note events reminders need no type, G2; new job/route names); `docs/features/events-and-forms.md` (signup flow mentions reminder picker + `event_signup_reminder`); `docs/setup/web-push.md` L50/61/77 (`push_reminders_url`, job `push-reminders`, `*/5`); `docs/setup/notifications-runbook.md` L89/131/144/148/152/160/166/186 (same renames; reset recipe → `update meeting set reminder_pushed_minutes = '{}'` and `update event_signup_reminder set pushed_at = null where event_id = …`); `docs/features.md:74` one-liner. | as listed | — |
| 16 | mechanic | `graphify update .` after code lands (per CLAUDE.md). | — | — |

Gates: `./dev npm run lint`, `./dev npm run typecheck`, `./dev npm run test`, `./dev npm run e2e`
(e2e is ~13 min — run it last / split per `project-hub-e2e-exceeds-tool-timeout`).

## File inventory

| Path | Action |
| --- | --- |
| `supabase/migrations/20260910120000_reminder_offsets.sql` | new |
| `supabase/migrations/20260910120100_push_reminders_cron.sql` | new |
| `src/lib/reminder-minutes.ts` (+ `.test.ts`) | new |
| `src/lib/event-reminder.ts` (+ `.test.ts`) | new |
| `src/lib/meeting-reminder.ts` (+ `.test.ts`) | rewrite |
| `src/lib/meetings.ts` (+ `.test.ts` L145) | edit |
| `src/lib/push-dispatch.ts` (+ `.test.ts`) | edit |
| `src/lib/notification-types.ts` | edit (description only) |
| `src/lib/types.ts` | edit |
| `src/lib/event-signups.ts` (+ `.test.ts`) | edit |
| `src/lib/form-responses.ts` (+ `.test.ts`) | edit |
| `src/app/api/events/[id]/signup/route.ts` (+ `.test.ts`) | edit |
| `src/app/api/notifications/prefs/route.ts` (+ `.test.ts`) | edit |
| `src/app/api/cron/push/reminders/route.ts` (+ `.test.ts`) | new |
| `src/app/api/cron/push/meeting-reminder/` | delete |
| `src/app/route-auth-allowlist.test.ts` | edit (swap entry) |
| `src/components/ReminderPicker.tsx` | new |
| `src/components/EventSignupButton.tsx`, `EventSignupForm.tsx` | edit |
| `src/app/me/notifications/page.tsx`, `NotificationSettings.tsx` | edit |
| `e2e/notifications.spec.ts`, `e2e/event-signup-forms.spec.ts` | extend |
| `docs/features/push-notifications.md`, `docs/features/events-and-forms.md`, `docs/setup/web-push.md`, `docs/setup/notifications-runbook.md`, `docs/features.md` | edit |
