# Sync run history — design

Branch: `sync-run-history`. (Filename given by the orchestrator; siblings use `YYYY-MM-DD-<name>-design.md`.)

## 1. Problem & constraints

Five integration syncs (FIRST roster, Google Calendar, Drive groups, GitHub teams, Slack membership)
report through one seam, `reportSyncOutcome()` in `src/lib/slack-alerts.ts`, which posts to
`#hub-admin-alerts` only on an ok↔failing *transition* and stores one overwritten
`app_setting.slack_alert_state_<source>` row. Nothing persists *when* a sync ran, how long it took,
what it changed, or what error it threw. An admin investigating "Google Calendar sync is failing"
has one Slack line and Vercel logs.

Constraints that shape the design (all from `AGENTS.md` / repo conventions):

- Schema = a committed migration; RLS on with zero policies + `grant all … to service_role`.
- `reportSyncOutcome` **never throws** — alerting must not break the sync. Recording must not either.
- No state-changing GET. "Run now" must POST.
- New page → `NAV_ITEMS` + `nav-destinations.test.ts`; any new `getDb()` route → `withRole()` or
  `ROUTE_AUTH_ALLOWLIST`.
- Ponytail: smallest change that solves the problem; reuse `SyncNowPanel`-style client fetch,
  `/admin/sessions`-style `<form method="get">` filters, native `<input type="date">`, `<details>`.

Decisions already made (not reopened): one row per run (no step logs); 5 sync sources only; a
"Run now" button per source that POSTs the existing route; 90-day retention pruned by the existing
`close-stale-sessions` pg_cron job; filter by source / status / time range.

## 2. Chosen approach

### 2.1 Schema — `supabase/migrations/20260911120000_sync_run.sql`

Latest version on `origin/master` is `20260910120100`; `20260911120000` is later and unused in
this worktree.

```sql
create table sync_run (
  id          uuid primary key default gen_random_uuid(),  -- repo convention (tool_maintenance.sql); ordering is by finished_at
  source      text not null
    check (source in ('first_sync','calendar_sync','drive_sync','github_sync','slack_sync')),
  ok          boolean not null,
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  error       text,      -- null when ok. Error.stack when available (first line = message), else the
                         -- message string; truncated to 8000 chars in insertSyncRun().
  detail      jsonb      -- flat {name: number} counts supplied by the caller; null on failure.
);
-- The page lists newest-first with optional source/ok/date filters. ~10k rows max at 90 days
-- (first_sync every 15 min dominates), so one ordering index is plenty.
create index sync_run_finished_at_idx on sync_run (finished_at desc);
alter table sync_run enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on sync_run to service_role;
```

No `duration_ms` column — derived as `finished_at - started_at` at render time. No `trigger`
(cron vs manual) column — YAGNI; a later migration can add it if admins ask.

**Retention (same migration).** `close_stale_sessions()` was last replaced in
`20260815120000_auto_close_toggle.sql` and now `return 0`s early when `auto_close_enabled` is false
(seeded false, still false in prod). A prune placed *after* that gate would never run. So the
migration `create or replace`s the function with the whole current body copied verbatim and **one
statement inserted before the gate**:

```sql
  -- Nightly housekeeping that must run regardless of the auto-close toggle.
  delete from public.sync_run where finished_at < now() - interval '90 days';
```

Repeat the trailing `revoke execute on function public.close_stale_sessions() from public, anon,
authenticated;` as the two prior replacements did. Do **not** re-run `cron.schedule('close-stale-sessions', …)`:
`/admin/cron` lets admins reschedule the job and that would clobber their edit. The manual
`/api/admin/sessions/run-sweep` route calls the same function, so it prunes too — harmless.

### 2.2 The seam — `src/lib/slack-alerts.ts`

`reportSyncOutcome` grows two optional opts and writes one row before alerting:

```ts
opts: {
  db: SupabaseClient; slack?: SlackDeps; push?: PushDeps;
  error?: string | Error;            // was string. Error → stack stored, message alerted.
  startedAt?: number;                // Date.now() captured by the caller before the sync; default now
  detail?: Record<string, number>;   // flat counts; stored as jsonb
}
```

Inside, **before** the existing `try`, in its own try/catch so a DB write failure can never
suppress the Slack alert (and so the existing `slack-alerts.test.ts` fake DB keeps working once it
grows `.insert`):

```ts
const message = opts.error instanceof Error ? opts.error.message : opts.error;
try {
  await insertSyncRun({ source, ok, startedAt: opts.startedAt ?? Date.now(),
    error: ok ? null : (opts.error instanceof Error ? opts.error.stack ?? opts.error.message : opts.error ?? "unknown").slice(0, 8000),
    detail: ok ? opts.detail ?? null : null }, opts.db);
} catch (e) { console.error(`[slack-alerts] insertSyncRun(${source}) threw:`, e); }
```

The alert text keeps using `message` (unchanged behavior) and gains a deep link:
`\n<${HUB_URL}/admin/sync-runs?source=${source}|View run history>` — `HUB_URL` is a leaf constant in
`src/lib/email-template.ts`; the mrkdwn `<url|text>` form is already used in `slack-channels.ts`.

`LABELS` moves out of this file into `sync-runs.ts` (see 2.3) and is imported back; `AlertSource`
stays exported from here (`sync-runs.ts` imports it type-only, so there is no runtime cycle).

**startedAt decision.** Callers pass it (Option "caller passes startedAt"). Each of the six call
sites adds one line, `const startedAt = Date.now();`, above its `try`, and adds `startedAt` to the
two existing `reportSyncOutcome` calls. Rejected alternatives:

- *Helper that wraps the sync and reports* (`recordSyncRun(source, db, fn)`): net-smaller per
  caller, but `membership-sync/route.test.ts` and `backfill/route.test.ts` `vi.mock("@/lib/slack-alerts")`
  wholesale — a wrapper living there that *executes* the sync would be mocked away and swallow the
  sync under test. It also flattens `first/sync/route.ts`, which rewrites the error message per
  branch (`first_session_expired` → friendly text) before reporting.
- *Insert at start, update at end*: gives "running" rows and survives a hard function timeout, but
  every caller must thread a run id through — exactly the boilerplate the brief said to avoid.
  `ponytail:` rows are written only at the end, so a Vercel function timeout leaves no row; the
  gap in the list *is* the signal. Upgrade to start/finish rows if that ever bites.

**Counts decision.** `detail jsonb`, contents = a flat `Record<string, number>` the caller builds.
Not the raw result object: `first_sync` runs every 15 min (~8.6k rows / 90 d) and `FirstSyncReport`
carries `unmatchedFirst`/`unmatchedHub` name+email lists; drive/github raw results are already kept
in `app_setting.drive_last_reconcile` / `github_last_reconcile`. Per caller:

| Route | `detail` |
| --- | --- |
| calendar | `result` as-is (`SyncResult` is already four numbers) |
| drive-group (+ backfill) | `{ groups, added, wouldRemove, errors }` — the `reduce` sums the backfill route already computes |
| github-team (+ backfill) | `{ teams, added, pending, wouldRemove, errors }` — same pattern |
| first | `{ roster: rosterCount, matched, updated, unmatchedFirst: len, unmatchedHub: len }` |
| slack membership | `{ linked, alreadyLinked, ambiguous: len, channels: totals.channels, invited: totals.invited, alreadyIn, failed }` |

**Error decision.** Decision 1 asked for message + stack. Cheapest way that honors it without
changing what Slack shows: `error?: string | Error`. Five callers currently pass
`e instanceof Error ? e.message : String(e)` — they simplify to `error: e`. `first/sync` keeps its
two string branches (friendly messages) and passes `e` in the generic branch. `insertSyncRun` stores
`err.stack ?? err.message` (Node stacks start with `Name: message`, so the first line is the message
and the UI needs no parsing), truncated to 8000 chars (the `.slice` lives in `reportSyncOutcome`,
shown above; `insertSyncRun` stores what it is given). `first/sync`'s `first_not_configured` branch
already calls `reportSyncOutcome(false, { error: msg })`, so a misconfigured FIRST sync shows up as
a failed row with error `first_not_configured` — no special case. Secrets: today the same message is already
posted verbatim to a Slack channel; the admin-only table is not a wider exposure. No redaction pass
— the sync libraries already avoid logging cookies/tokens (`first/sync` comment: "never logs the
cookie").

**Backfill route** (`api/admin/teams/[id]/backfill`): its drive/github reconciles are the same
whole-graph reconcile the nightly cron runs and already flip alert state — log them as runs.
Two `startedAt` lines, `error: e`, `detail` sums it already computes.

### 2.3 Library — `src/lib/sync-runs.ts` (new, dependency-light: `@supabase/supabase-js` types only)

Safe to import from a `"use client"` component; `slack-alerts.ts` (which pulls in
`admin-notify → push-dispatch`) must **not** be imported at runtime by the client button.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSource } from "./slack-alerts";   // type-only, no runtime cycle

export const SYNC_SOURCES: { source: AlertSource; label: string; endpoint: string }[] = [
  { source: "first_sync",    label: "FIRST roster sync",       endpoint: "/api/admin/first/sync" },
  { source: "calendar_sync", label: "Google Calendar sync",    endpoint: "/api/admin/calendar/sync" },
  { source: "drive_sync",    label: "Google Drive group sync", endpoint: "/api/admin/drive-group/sync" },
  { source: "github_sync",   label: "GitHub team sync",        endpoint: "/api/admin/github-team/sync" },
  { source: "slack_sync",    label: "Slack membership sync",   endpoint: "/api/cron/slack/membership-sync" },
];
export const SYNC_SOURCE_LABELS: Record<AlertSource, string> = /* derived from SYNC_SOURCES */;

export type SyncRun = { id: number; source: AlertSource; ok: boolean; startedAt: string;
  finishedAt: string; error: string | null; detail: Record<string, number> | null };

export type SyncRunFilter = { source?: AlertSource; ok?: boolean; from?: string; to?: string; page: number };
export const SYNC_RUN_PAGE_SIZE = 50;

/** Validate raw searchParams → SyncRunFilter. PURE. Next hands over `string | string[] | undefined`
 *  per key: arrays take the first element. Unknown source / ok not in {"true","false"} / dates not
 *  matching ^\d{4}-\d{2}-\d{2}$ are dropped; page = positive int, else 1. */
export function parseSyncRunFilter(params: Record<string, string | string[] | undefined>): SyncRunFilter;

/** Newest first. Fetches PAGE_SIZE+1 rows and reports hasMore instead of a count query. Throws on db error. */
export async function listSyncRuns(filter: SyncRunFilter, db: SupabaseClient): Promise<{ runs: SyncRun[]; hasMore: boolean }>;

/** Never throws is the CALLER's job (reportSyncOutcome wraps it); this checks `error` and throws. */
export async function insertSyncRun(row: { source; ok; startedAt: number; error: string | null;
  detail: Record<string, number> | null }, db: SupabaseClient): Promise<void>;
```

`listSyncRuns` query: `.from("sync_run").select("*")`, `.eq("source", …)`, `.eq("ok", …)`,
`.gte("finished_at", from)`, `.lt("finished_at", <to + 1 day>)`, `.order("finished_at", { ascending: false })`,
`.range(offset, offset + PAGE_SIZE)`; always check `error`. Date strings are `YYYY-MM-DD` from
`<input type="date">` and are compared as UTC day bounds — a few hours off the team's local day,
acceptable for a 90-day investigation view (ponytail: convert via `team_timezone` if anyone notices).

### 2.4 Page — `src/app/admin/sync-runs/page.tsx` (server component, admin gate)

Template: `src/app/admin/cron/page.tsx` for the shell, `src/app/admin/sessions/page.tsx` for
`searchParams` + `<form method="get">`. Admin-only because `first_sync` is admin-only and the page
sits in the Config section.

- Props: `{ searchParams: Promise<Record<string, string | string[] | undefined>> }` (sessions page
  narrows this per key; here the validator does the narrowing). `await` it →
  `parseSyncRunFilter` → `listSyncRuns(filter, getDb())` + `getTeamTimezone()`.
- Filter bar: `<form method="get">` with `<select name="source">` (All + `SYNC_SOURCES`),
  `<select name="ok">` (All / Success / Failed), `<input type="date" name="from">`,
  `<input type="date" name="to">`, Apply button. Filters live in the URL (shareable from a Slack
  alert; the deep link is `?source=<source>`). No client state.
- `<RunNowButtons />` (2.5) above the table.
- Table (`.tablewrap > .table`, as in drive-sync): Source · Status (ok/failed, red text on failure)
  · Finished (`toLocaleString(undefined, { timeZone: teamTz })`, same as `ReconcileReport`) ·
  Duration (`finished_at - started_at`, formatted `1.2s` / `2m 05s`) · Changes (`detail` rendered
  `meetings 12 · buildDays 3`) · Error (first line in the cell; full text inside a native
  `<details><summary>`, `pre`-wrapped, `mono`).
- Pagination: "Newer" / "Older" `<Link>`s preserving the other query params, `?page=N`; "Older"
  only when `hasMore`. No count query.
- Empty state: "No runs match." — and, when no filters, "No syncs have run since this was deployed."
- If `listSyncRuns` throws, let it surface (matches `listCronJobs` on the cron page).

### 2.5 "Run now" — `src/components/RunNowButtons.tsx` (client)

One button per `SYNC_SOURCES` entry; shared handler, modelled on `SyncNowPanel.tsx`:

- `fetch(endpoint, { method: "POST" })` — POST only, never GET (AGENTS.md CSRF rule).
- All five endpoints already insert their own `sync_run` row via `reportSyncOutcome`, so the button
  does not need to interpret the response body. On completion (ok or not) it
  `router.push(\`/admin/sync-runs?source=${source}\`)` and `router.refresh()`, so the fresh run is
  the top row regardless of the filters that were active.
- Inline status under the button row: while running "Running <label>…" (button disabled); on
  non-2xx "Failed: `body.error ?? HTTP <status>`" in red (`not_configured`, `session_expired`,
  `sync_failed`, `masquerade_read_only`, `forbidden` all surface as-is — the table row has the
  detail). A network throw shows its message.
- Syncs can take minutes (GitHub/Slack nightly); no timeout on the client, the button just stays
  disabled.

**Auth audit of the five routes for an admin session:**

| Route | Gate today | Admin can POST? |
| --- | --- | --- |
| `api/admin/first/sync` | secret OR admin session | yes |
| `api/admin/calendar/sync` | secret OR mentor+ session | yes |
| `api/admin/drive-group/sync` | secret OR mentor+ session | yes |
| `api/admin/github-team/sync` | secret OR mentor+ session | yes |
| `api/cron/slack/membership-sync` | **secret only** | **no** |

Decision: add Gate 2 to `membership-sync/route.ts` exactly as the four siblings do —
`getViewer()` + `hasRole(viewer.role, "admin")` (admin, not mentor: the other Slack admin route
`api/admin/slack/link-sync` is admin-gated) + `masqueradeReadOnly(viewer)`. Update its
`ROUTE_AUTH_ALLOWLIST` note to `"x-sync-secret (constant time) OR getViewer()+hasRole('admin')."`.
Its `route.test.ts` must add `vi.mock("@/lib/viewer", …)` returning a guest viewer for the existing
403 cases (otherwise they now fall through to a real `getViewer`) and one new case: admin session,
no secret → 200. Rejected: no Run-now for Slack — inconsistent UI for a 10-line change with precedent.

### 2.6 Registration & docs

- `src/lib/nav-destinations.ts`: `{ label: "Sync runs", href: "/admin/sync-runs", group: "Admin", gate: "admin", section: "Config" }` just before "Cron jobs".
- `src/lib/nav-destinations.test.ts` **and** `e2e/auth-gating.spec.ts`: add `/admin/sync-runs` to
  `ADMIN_ONLY_HREFS` in both (the comment says they are the same set).
- `src/app/admin/page.tsx` Config section: copy the existing Cron jobs `<Card … icon="clock" …>`
  line (currently L203) verbatim and change only `href="/admin/sync-runs"`, `title="Sync runs"`,
  `hint="History of every integration sync, with Run now."`; place it just above Cron jobs.
- `docs/features.md` Integrations: one catalog line. `docs/features/sync-run-history.md`: short
  behavior page (what's recorded, 90-day prune, deep link, timeout caveat).

### 2.7 Data flow

```
pg_cron / Run-now button ──POST──▶ sync route
  const startedAt = Date.now()
  try   { result = await sync(); reportSyncOutcome(src, true,  { db, startedAt, detail: counts(result) }) }
  catch { reportSyncOutcome(src, false, { db, startedAt, error: e }) ; 502 }
                     │
                     ▼ reportSyncOutcome (never throws)
        try { insertSyncRun(...) } catch → console.error      ← own try; a failed write never mutes the alert
        prev = slack_alert_state_<src>; if changed → notifyAdmins(text + "<HUB_URL/admin/sync-runs?source=src|View run history>")
                     │
/admin/sync-runs ◀── listSyncRuns(filter) ◀── searchParams (source, ok, from, to, page)
close-stale-sessions (daily 08:00 UTC) → close_stale_sessions() → delete sync_run older than 90 d, then the existing gated sweep
```

## 3. Alternatives considered

- **Fold into `/admin/cron`.** That page is pg_cron schedules keyed by `jobid`; sync runs are keyed
  by `AlertSource`, two of which are also triggered manually. Different axis, different filters —
  a separate page is less code than teaching `CronJobsEditor` two data models.
- **Client-side fetch + `/api/admin/sync-runs` GET route.** Adds a route (allowlist/withRole) and
  client state for no gain; the server component + query-param form is the established pattern.
- **Typed count columns** (`created`, `updated`, `skipped`). The five results share no such vocabulary
  (meetings/buildDays vs added/wouldRemove vs matched/updated vs invited/alreadyIn). Forcing them
  into three ints loses exactly the information admins want.
- **Store the raw result as `detail`.** Rejected for size and PII (see 2.2).
- **Per-source summarizer inside `slack-alerts.ts`.** Couples the alert seam to five result types;
  callers already know their shape and the backfill route already writes the sums inline.
- **Prune via `cron.alter_job(command := …)`** instead of editing the function. Also valid and keeps
  the function single-purpose, but relies on multi-statement job commands and touches the job row
  admins edit from `/admin/cron`; the `create or replace` precedent exists twice already.

## 4. Trade-offs & risks

- **No "running" state / lost rows on hard timeout.** Accepted (ponytail note in 2.2).
- **Alert-state and run-row are two writes, not one transaction.** If the insert fails the alert
  still fires and the state row still advances; the list just lacks that run. Logged server-side.
- **`error: string | Error` widening.** Any test asserting `reportSyncOutcome` was called with a
  string `error` (`backfill/route.test.ts` — check) needs updating to `expect.any(Error)` or `.message`.
- **`slack-alerts.test.ts` fakeDb** has no `.insert`; without extending it the insert throws
  (caught, logged) on every test — noisy, and it hides a broken write. Extend the fake and assert.
- **First sync volume.** ~96 rows/day is fine; watch it if the cadence ever drops below 5 min.
- **Date filter is UTC-day, not team-day.** Documented; cheap to fix later via `team_timezone`.
- **Deep link is hardcoded prod `HUB_URL`.** Local alerts already redirect to `#bot-test`; a wrong
  host in dev is cosmetic.
- **Migration version collision.** Re-check `git log origin/master --name-only -- supabase/migrations`
  immediately before committing the migration; bump if `20260911120000` has appeared.

## 5. Implementation outline (ordered, each independently committable)

1. **`mechanic`** — Migration `supabase/migrations/20260911120000_sync_run.sql`: table + index + RLS +
   grant exactly as 2.1; `create or replace function public.close_stale_sessions()` = verbatim body
   from `20260815120000_auto_close_toggle.sql` with the 90-day `delete` inserted before the
   `auto_close_enabled` gate; repeat the `revoke execute` line. Verify with `./dev npm run db:reset`.
2. **`coder`** — `src/lib/sync-runs.ts` (2.3) + `src/lib/sync-runs.test.ts`: unit test for
   `parseSyncRunFilter` only (drops bad source/ok/dates, first-of-array, clamps page) — it is the
   trust-boundary validator. No fake query builder for `listSyncRuns`; the page verifies the query
   in-browser (task 6). Move `LABELS` here as `SYNC_SOURCE_LABELS`; `slack-alerts.ts` imports it.
3. **`coder`** — `src/lib/slack-alerts.ts`: opts widen (`error: string | Error`, `startedAt`,
   `detail`), own-try `insertSyncRun` before alerting, deep link appended to the failing text.
   `slack-alerts.test.ts`: fakeDb gains `insert` (records rows), new assertions: a row is written on
   ok and on failure (with `error` text containing the message, `detail` on ok), an insert that
   throws still posts the alert, `Error` input alerts with `.message` only.
4. **`coder`** — Callers: `calendar/sync`, `drive-group/sync`, `first/sync`, `github-team/sync`,
   `teams/[id]/backfill`, `cron/slack/membership-sync` — add `startedAt`, pass `error: e` (strings
   kept in `first/sync`'s two friendly branches), pass `detail` per the 2.2 table. Fix
   `backfill/route.test.ts` expectations if they assert the `error` arg shape. Full suite
   (`./dev npm run test`), not a filtered run — `route-auth-allowlist.test.ts` and stale-mock
   failures only show there.
5. **`coder`** — `membership-sync/route.ts` Gate 2 (admin session + `masqueradeReadOnly`, mirroring
   `drive-group/sync`); `route-auth-allowlist.test.ts` note updated; `route.test.ts` mocks
   `@/lib/viewer` (guest for existing 403s) + new admin-session 200 case.
6. **`coder`** — `src/components/RunNowButtons.tsx` (2.5) + `src/app/admin/sync-runs/page.tsx` (2.4).
   Verify in-browser via the dev-login Admin button: filters round-trip through the URL, Older/Newer,
   Run now on Calendar shows a new top row, `<details>` opens the stack.
7. **`mechanic`** — Registration: `nav-destinations.ts` item; `/admin/sync-runs` added to
   `ADMIN_ONLY_HREFS` in `nav-destinations.test.ts` and `e2e/auth-gating.spec.ts`; Config `Card`
   in `src/app/admin/page.tsx`.
8. **`mechanic`** — Docs: `docs/features.md` Integrations line; `docs/features/sync-run-history.md`.
9. **`coder`** — Gates before PR: `./dev npm run lint`, `typecheck`, `test`, `e2e` (auth-gating spec
   must see the new admin-only href). Then push + `gh pr create`.
