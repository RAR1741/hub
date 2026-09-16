# Weekly "What's new in the hub" Slack digest — design

Issue: #204. Branch: `whats-new-slack-digest`.

## 1. Summary

Every Monday at 13:00 UTC (9am EDT / 8am EST) a pg_cron job POSTs to a new secret-gated route,
`POST /api/cron/slack/whats-new`. The route lists PRs merged to `RAR1741/hub` in the trailing
7 days via one GitHub REST call, renders them as plain Slack mrkdwn (a "Watch out for" section for
PRs labelled `heads-up`, then "What's new" for the rest), and posts to `#hub-admin-alerts` through
the existing `postChannelMessage` (which auto-redirects to `#bot-test` outside production). No LLM,
no persisted cursor, no new secret, no new tables, no GitHub App permission change (the repo is
public). An empty week posts nothing.

## 2. Decisions already fixed (not reopened here)

| Decision | Value |
| --- | --- |
| Summarisation | Deterministic; PR titles verbatim, no model |
| Data source | Merged PRs only (`merged_at` non-null, base `master`) |
| Channel | `hub-admin-alerts` (`src/lib/slack-registry.ts`, `C0BTB9TMAE8`) |
| Cadence | `0 13 * * 1` (Mon 13:00 UTC). pg_cron runs in UTC: 9am EDT, **8am EST after DST ends** — accepted; adjustable in `/admin/cron` |
| Window | Stateless `now - 7d .. now` on `merged_at`; a failed run drops that week |
| Watch-out marker | GitHub PR label `heads-up` (exact name match) |
| Empty week | Skip post; return `{ posted: false, count: 0 }` |
| Format | Plain mrkdwn text; no Block Kit |
| Auth for the route | Reuse `app_setting.slack_reminder_secret`; new `whats_new_url` setting only |

## 3. File inventory

| Path | Change | Responsibility |
| --- | --- | --- |
| `src/lib/whats-new.ts` | new | Types, `fetchMergedPrs`, pure `formatWhatsNew`, orchestrator `sendWhatsNewDigest` |
| `src/lib/whats-new.test.ts` | new | Pure formatter + orchestrator tests with injected fetch |
| `src/app/api/cron/slack/whats-new/route.ts` | new | POST, secret check, calls orchestrator — mirrors `mentor-reminders/route.ts` |
| `src/app/api/cron/slack/whats-new/route.test.ts` | new | 403/200 auth tests — mirrors `event-channels/route.test.ts` |
| `src/lib/github-app.ts` | 3-line edit | Export `githubBaseHeaders()`; `githubHeaders(token)` spreads it (see §4.2) |
| `supabase/migrations/20260907120000_whats_new_slack_cron.sql` | new | Seed `whats_new_url`, schedule `slack-whats-new-weekly` |
| `docs/features/whats-new-digest.md` | new | Behaviour page: label convention, DST, prod config, observability gap |
| `docs/features.md` | 1 line | Catalog entry under Integrations (near L114) |
| `docs/setup/slack.md` | 3 small edits | Settings table row, prod SQL upsert, troubleshooting line |
| `docs/features/slack-integration.md` | 1 bullet | Cross-reference to the new page |

Nothing else. No new env vars, no schema tables, no UI.

## 4. Data flow

```
pg_cron (Mon 13:00 UTC)
  └─ net.http_post whats_new_url, header x-sync-secret = slack_reminder_secret
       └─ POST /api/cron/slack/whats-new
            ├─ getSetting("slack_reminder_secret") → secureEqual → 403 on mismatch/empty
            └─ sendWhatsNewDigest(deps)
                 ├─ fetchMergedPrs: 1 GitHub GET (+1 token POST when App creds present)
                 ├─ filter: merged_at in [start, end)
                 ├─ formatWhatsNew(prs, window) → string | null
                 └─ null → {posted:false,count:0}; else postChannelMessage(slack, "hub-admin-alerts", text)
```

### 4.1 Deps and types (`src/lib/whats-new.ts`)

```ts
import type { SlackDeps } from "./slack";
import type { GithubAppCredentials } from "./github-app";

export type MergedPr = {
  number: number;
  title: string;
  htmlUrl: string;
  mergedAt: string;      // ISO, from GitHub `merged_at`
  author: string;        // GitHub `user.login`
  labels: string[];      // GitHub `labels[].name`
};

export type Window = { start: Date; end: Date };

export type WhatsNewDeps = {
  fetch: typeof globalThis.fetch;
  slack: SlackDeps;
  githubCredentials: GithubAppCredentials | null; // null ⇒ anonymous GitHub call
  now?: () => Date;
};

export const HEADS_UP_LABEL = "heads-up";
```

One `fetch` in the deps object. `GithubDeps` (which carries its own `fetch`) is built *inside*
`fetchMergedPrs` as `{ fetch: deps.fetch, credentials, now: deps.now }` only when credentials are
present — do not put two fetches in the deps object.

### 4.2 Fetch: `fetchMergedPrs(deps, window): Promise<MergedPr[]>`

Endpoint (exactly):

```
GET https://api.github.com/repos/{owner}/hub/pulls?state=closed&base=master&sort=updated&direction=desc&per_page=100
```

- `owner = process.env.GITHUB_ORG ?? "RAR1741"`. `GITHUB_ORG` is the env var the App code
  already uses for the org (`githubAppCredentialsFromEnv`, `.env.example` L47 `GITHUB_ORG=RAR1741`);
  the fallback covers dev with no GitHub env at all. Repo name `hub` is a constant — confirmed via
  `gh repo view RAR1741/hub` (name `hub`, visibility **PUBLIC**).
- `base=master` is an addition to the pre-decided URL: a free server-side pre-filter matching
  decision #2 ("merged to master"); `merged_at` remains the client-side gate.
- Not `/search/issues` — its semantics changed in 2025 and the pulls list is sufficient.
- **Auth decision:** when `githubAppCredentialsFromEnv()` returns non-null, obtain an installation
  token via the existing `fetchInstallationToken()` and send `githubHeaders(token)` — this mirrors
  every other GitHub call in the codebase and gives 5000 req/h headroom. When creds are null (the
  normal dev case — `githubAppCredentialsFromEnv` requires all six vars including the OAuth
  client id/secret), call anonymously. **Because `RAR1741/hub` is public, both paths read the same
  data and no GitHub App repository permission is needed** — the App keeps "Organization → Members"
  only, per `docs/setup/github-app.md` §1 step 4. Anonymous is 60 req/h per IP; one call a week is
  negligible.
- If the token exchange throws (e.g. rotated key), log a warning and fall back to anonymous
  rather than losing the week. Anonymous always works for a public repo.
- Anonymous headers: `githubHeaders("")` would send `Authorization: Bearer ` and get a 401, so
  make the 3-line refactor in `src/lib/github-app.ts`:

  ```ts
  /** Headers every GitHub REST call sends, with or without auth. */
  export function githubBaseHeaders(): Record<string, string> {
    return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rar1741-hub" };
  }
  export function githubHeaders(token: string): Record<string, string> {
    return { ...githubBaseHeaders(), Authorization: `Bearer ${token}` };
  }
  ```

  Behaviour of `githubHeaders` is unchanged; existing tests keep passing.
- Non-2xx from the pulls endpoint ⇒ `throw new Error(\`whats-new: list pulls failed: ${status}\`)`.
  The route turns that into 502 (mirrors mentor-reminders).
- Map each item to `MergedPr` (`html_url`, `merged_at`, `user.login`, `labels[].name`), drop
  `merged_at == null`, keep `start <= merged_at < end`. The `sort=updated` fetch order is only
  there so recently-merged PRs land in the first page; it's irrelevant after filtering.
- Single page. `// ponytail: one page of 100; a week where >100 closed PRs get touched would drop
  the oldest merges — add page=2 when that happens.` Recent weeks are ~5–15 PRs.

### 4.3 Window math (in `sendWhatsNewDigest`)

```ts
const end = (deps.now ?? (() => new Date()))();
const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
```

`// ponytail: stateless 7-day lookback keyed to run time. A failed/skipped run drops that week's
PRs; a PR merged inside the few-second jitter between consecutive Monday fires can appear twice or
never. Add a last-run cursor in app_setting if either bites.`

### 4.4 Format: `formatWhatsNew(prs: MergedPr[], window: Window): string | null` — PURE

- Returns `null` when `prs.length === 0`.
- Sort by `mergedAt` ascending (chronological, deterministic for tests).
- Partition: `watchOut = prs.filter(p => p.labels.some(l => l.toLowerCase() === HEADS_UP_LABEL))`
  (case-insensitive so a label created as `Heads-up` in the GitHub UI still matches), `rest` = others.
- Header: `*What's new in the hub* (2026-08-31 – 2026-09-07)` using `toISOString().slice(0, 10)`
  of `window.start` / `window.end`. UTC ISO dates are tz-free and pure; for the 13:00 UTC schedule
  they equal the local calendar dates. If someone reschedules to within ~5h of midnight ET the UTC
  date can be off by one — accepted, no timezone lookup.
- Bullet: `• <${htmlUrl}|${esc(title)}> (#${number}, @${author})`. `esc` replaces `&`→`&amp;`,
  `<`→`&lt;`, `>`→`&gt;` — a `>` in a title otherwise breaks the `<url|text>` link. Slack only
  requires these three.
- Sections: when `watchOut` is non-empty, `:warning: *Watch out for*` + its bullets come **first**,
  then `*What's new*` + the rest (omit the "What's new" heading and section if `rest` is empty;
  omit the watch-out section if empty). Blank line between sections.
- Author is the GitHub login; no Slack mention mapping (deliberately skipped).

Rendered — no heads-up PRs:

```
*What's new in the hub* (2026-08-31 – 2026-09-07)

*What's new*
• <https://github.com/RAR1741/hub/pull/261|GitHub sync: allow inactive members> (#261, @dracco1993)
• <https://github.com/RAR1741/hub/pull/262|Tool maintenance tracking> (#262, @dracco1993)
• <https://github.com/RAR1741/hub/pull/265|Umbrella team resource inheritance> (#265, @dracco1993)
```

Rendered — with a heads-up PR:

```
*What's new in the hub* (2026-08-31 – 2026-09-07)

:warning: *Watch out for*
• <https://github.com/RAR1741/hub/pull/264|Kiosk now signs students out after 12h> (#264, @dracco1993)

*What's new*
• <https://github.com/RAR1741/hub/pull/261|GitHub sync: allow inactive members> (#261, @dracco1993)
• <https://github.com/RAR1741/hub/pull/265|Umbrella team resource inheritance> (#265, @dracco1993)
```

In non-prod `postChannelMessage` prefixes `[dev → #hub-admin-alerts] ` and targets `#bot-test` —
no code in this feature handles that.

### 4.5 Orchestrator: `sendWhatsNewDigest(deps): Promise<{ posted: boolean; count: number }>`

1. Compute window (§4.3).
2. `prs = await fetchMergedPrs(deps, window)`.
3. `text = formatWhatsNew(prs, window)`; if `null` → `return { posted: false, count: 0 }` with no
   Slack call.
4. `posted = await postChannelMessage(deps.slack, "hub-admin-alerts", text)` (never throws; `false`
   when no token or Slack error) → `return { posted, count: prs.length }`.

`count` is the total PR count in window; `posted:false, count>0` therefore means "had content, Slack
send failed/no token", distinguishable from an empty week.

## 5. Route (`src/app/api/cron/slack/whats-new/route.ts`)

Copy `src/app/api/cron/slack/mentor-reminders/route.ts` byte-for-byte except the call:

```ts
const result = await sendWhatsNewDigest({
  fetch: globalThis.fetch,
  slack: slackDepsFromEnv(),
  githubCredentials: githubAppCredentialsFromEnv(),
});
return Response.json(result);
```

Confirmed from the mentor-reminders route: `getSetting<string>("slack_reminder_secret", "", db)`
from `@/lib/settings` (signature `getSetting<T>(key, fallback: T, db?: SupabaseClient)`);
`secureEqual(provided, secret)` from `@/lib/secure-compare`; guard is
`secret.length > 0 && provided != null && secureEqual(...)` so an empty secret fails closed;
errors → `console.error` + 502 `{ error: "failed" }`. Response is the bare result (mentor-reminders
style), not the `{ ok: true, ... }` wrapper event-channels uses.

POST only — no GET handler (AGENTS.md CSRF rule). Coder must read the route-handler guide in
`node_modules/next/dist/docs/` before writing the file (AGENTS.md).

## 6. Auth / secret reuse

- The cron sends `x-sync-secret` = `app_setting.slack_reminder_secret`, the same value the
  mentor-reminder cron already sends. Same trust boundary (pg_cron → app, both post to the same
  channel), already set in prod, one fewer thing to configure. Not renamed.
- Only the URL differs per route, so **one new `app_setting` key: `whats_new_url`**, seeded to the
  dev default `http://host.docker.internal:3000/api/cron/slack/whats-new`.
- **Prod prerequisite:** after merge, set `whats_new_url` to
  `https://hub.redalert1741.org/api/cron/slack/whats-new` in the prod SQL editor, or the cron POSTs
  to `host.docker.internal` forever and silently no-ops (same gotcha class as `slack_reminder_url`
  / `first_sync_url`).
- **Prod prerequisite (probably already met):** the prod `hub` bot must be a member of the private
  `#hub-admin-alerts` (registry comment "invite the prod bot once"; `docs/setup/slack.md` step
  "/invite @hub"). Mentor-reminder summaries already post there weekly, so if those are arriving
  this is done. If not, `chat.postMessage` returns `not_in_channel` in Vercel logs.

## 7. Migration — `supabase/migrations/20260907120000_whats_new_slack_cron.sql`

Latest on `origin/master` is `20260906130000_tool_maintenance.sql` (checked with
`git ls-tree origin/master`), so `20260907120000` is free.

```sql
-- Weekly "What's new in the hub" Slack digest via pg_net → the app endpoint.
-- Reuses slack_reminder_secret (same trust boundary as the mentor-reminder cron);
-- only the URL is new because it differs per route. URL read from app_setting
-- AT RUN TIME — seeded to the dev default, MUST be set per-env in prod.
insert into app_setting (key, value) values
  ('whats_new_url', '"http://host.docker.internal:3000/api/cron/slack/whats-new"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'slack-whats-new-weekly',
  '0 13 * * 1',  -- Mondays 13:00 UTC = 9:00am EDT (8:00am EST after DST ends; pg_cron runs in UTC)
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'whats_new_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'slack_reminder_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

No `timeout_milliseconds`: the mentor-reminder job sleeps 1.1s per mentor and already outlives any
pg_net default, yet works — the app finishes the request regardless of whether pg_net waits. The job
appears in `/admin/cron` (`list_cron_jobs` RPC) automatically and can be rescheduled there.

## 8. Test plan

### `src/lib/whats-new.test.ts` (vitest, style of `slack-channels.test.ts` / `mentor-reminders.test.ts`)

Helpers: a `fakeFetch(responses[])` that records `{url, init}` and dequeues canned responses (copy
from `slack-channels.test.ts` L19–31); `pr(overrides)` builder for GitHub pull JSON; fixed
`WINDOW = { start: 2026-08-31T13:00Z, end: 2026-09-07T13:00Z }`.

`formatWhatsNew`:
1. empty array → `null`.
2. header renders `(2026-08-31 – 2026-09-07)` from the window.
3. bullets: `• <url|title> (#n, @login)`; output sorted by `mergedAt` ascending regardless of input
   order.
4. heads-up grouping: PR with label `heads-up` appears under `:warning: *Watch out for*` and that
   section precedes `*What's new*`; other labels (`enhancement`) do not trigger it.
5. all PRs heads-up → no `*What's new*` heading.
6. escaping: title `A <b> & c` renders as `A &lt;b&gt; &amp; c`; URL untouched.

`sendWhatsNewDigest` (fake fetch answers GitHub then Slack; `slack: { fetch, token: "xoxb", isProd: true }`):
7. filters: response has one PR `merged_at` in window, one `merged_at: null` (closed unmerged), one
   merged 8 days ago → only the first is posted; `count: 1`.
8. anonymous path (`githubCredentials: null`): exactly one GitHub request, URL equals the exact
   endpoint in §4.2 with owner `RAR1741` (set/unset `GITHUB_ORG` via `vi.stubEnv`), request has
   `Accept`/`User-Agent` and **no** `Authorization` header.
9. credentialed path: creds with a PEM from `generateKeyPairSync("rsa", { modulusLength: 2048 })`
   (copy `github-app.test.ts` L14–15); fake fetch answers `/app/installations/…/access_tokens`
   with `{ token: "ghs_x" }` first, then the pulls list; assert the pulls request carries
   `Authorization: Bearer ghs_x`.
10. token exchange 500 → falls back to anonymous pulls call, still posts.
11. empty week → no `chat.postMessage` request, returns `{ posted: false, count: 0 }`.
12. GitHub 403 on pulls → rejects (route maps to 502).
13. Slack post body: `channel === "C0BTB9TMAE8"` (prod deps) and `text` starts with
    `*What's new in the hub*`; returns `{ posted: true, count: N }`.

### `src/app/api/cron/slack/whats-new/route.test.ts` (copy `event-channels/route.test.ts`)

Mock `@/lib/db`, `@/lib/settings`, and `@/lib/whats-new` (`sendWhatsNewDigest`) — same three-mock
shape as event-channels. `slackDepsFromEnv` / `githubAppCredentialsFromEnv` only read env and need
no mock since the orchestrator itself is mocked.
1. 403 when header missing. 2. 403 when wrong. 3. 403 when configured secret is `""`.
4. 200: `sendWhatsNewDigest` called once; body equals `{ posted: true, count: 3 }` exactly (bare, no
   `ok` wrapper). 5. 502 `{ error: "failed" }` when `sendWhatsNewDigest` rejects.

### Existing
`src/lib/github-app.test.ts` must still pass after the `githubBaseHeaders` refactor (no assertion
changes expected).

No new e2e spec (no UI; the route needs live GitHub). The existing e2e suite still runs as a PR
gate per AGENTS.md: `./dev npm run lint`, `typecheck`, `test`, `e2e`.

## 9. Docs to update

1. **New `docs/features/whats-new-digest.md`** — sections: What it posts (format, example);
   **The `heads-up` label convention** (apply the label to any PR whose change people should
   know before it bites — behaviour changes, removed features, new required steps; the label must
   exist in the repo; the repo has no label conventions yet so this is the first); Schedule
   (`slack-whats-new-weekly`, `0 13 * * 1`, 9am EDT / 8am EST, pg_cron is UTC, adjust in
   `/admin/cron`); Window (7 days back from run time, stateless, failed run drops the week);
   Config (`whats_new_url` per-env, reuses `slack_reminder_secret`, GitHub token optional — public
   repo, no App permission change); Local test recipe
   (`./dev bash -lc 'curl -s -XPOST localhost:3000/api/cron/slack/whats-new -H "x-sync-secret: <value>"'`
   → `#bot-test`); Observability gap (see §10).
2. **`docs/features.md`** Integrations section (after the Slack line at ~L114):
   `- **Weekly "What's new" Slack digest** — Monday post to #hub-admin-alerts listing last week's merged PRs, with a "Watch out for" section for PRs labelled \`heads-up\`. — see [features/whats-new-digest.md](features/whats-new-digest.md)`
3. **`docs/setup/slack.md`**: settings table (L43 area) add row
   `| app_setting | whats_new_url | URL pg_cron POSTs to for the Monday what's-new digest. **Seeded to a dev default — must be set per-env.** |`;
   step 4 SQL block (L89–94) add `('whats_new_url', '"https://hub.redalert1741.org/api/cron/slack/whats-new"'),`;
   step 5 verification queries include `slack-whats-new-weekly` / `whats_new_url`; troubleshooting
   "Cron never fires in prod" (L162) mention `whats_new_url` alongside `slack_reminder_url`.
4. **`docs/features/slack-integration.md`**: one bullet/short section "Weekly what's-new digest —
   see [whats-new-digest.md](whats-new-digest.md)" and add `hub-admin-alerts` consumers note if
   desired (optional).

## 10. Risks, trade-offs, open questions

- **Observability gap (inherited).** `/admin/cron` shows pg_cron's SQL status; `net.http_post`
  succeeds as a statement even when the route returns 403/502, so a broken digest looks green.
  The only signal is a missing Monday post. mentor-reminders has the identical gap, so mirroring is
  defensible. *Open question (default: no):* also call `reportSyncOutcome()` from
  `src/lib/slack-alerts.ts` on failure — would need a new `AlertSource` member and posts to the same
  channel; deferred unless the user wants it.
- **Prod config is manual.** `whats_new_url` must be set per-env after merge or the job no-ops
  silently. Called out in three docs; still a human step.
- **`heads-up` label does not exist yet** (`gh label list` confirmed). Creating it mutates the
  repo — a human step (or approved `gh label create heads-up --color D93F0B --description "..."`),
  not an unattended mechanic task. Until applied, every PR lands under "What's new" — harmless.
- **DST drift** of one hour, accepted by decision.
- **Rate limit / fetch shape.** Single page of 100; anonymous 60/h. Both have ponytail comments
  with the upgrade path.
- **Bot / merge-commit PRs** (e.g. dependabot) would be listed like any other. None exist today;
  YAGNI, add an author filter if noise appears.
- **Duplicate/missed PR at the window boundary** within pg_cron's per-fire jitter — negligible,
  noted in the ponytail comment.
- **Merge-order caveat:** the migration version `20260907120000` must still be the newest when
  the PR merges; if another PR lands a later-dated migration first, rename (new file, never edit an
  applied one — this one is unapplied until merge, so a rename in the PR is fine).

## 11. Ordered task list

Each task is self-contained given this spec. Commit + push after each (AGENTS.md). Run in the
worktree `C:\Users\Jordan\Documents\Git\hub\.worktrees\whats-new-slack-digest`.

1. **[coder] `githubBaseHeaders` refactor** — `src/lib/github-app.ts` per §4.2; run
   `./dev npm run test -- github-app` to confirm no regressions. Commit `refactor(github-app): split
   githubBaseHeaders out of githubHeaders`.
2. **[coder] `src/lib/whats-new.ts` + `src/lib/whats-new.test.ts`** — TDD: write formatter tests
   (§8 cases 1–6) → `formatWhatsNew`; then orchestrator tests (7–13) → `fetchMergedPrs` +
   `sendWhatsNewDigest`. Types/deps/endpoint/escaping/ponytail comments exactly as §4. Commit.
3. **[coder] Route + route test** — `src/app/api/cron/slack/whats-new/route.ts` (§5, read the
   Next route-handler doc in `node_modules/next/dist/docs/` first) and `route.test.ts` (§8).
   Commit.
4. **[mechanic] Migration** — create `supabase/migrations/20260907120000_whats_new_slack_cron.sql`
   with the exact SQL in §7. Verify with `./dev npm run db:reset` — a malformed `insert` or
   `cron.schedule` fails the reset; a clean reset is the check. Commit.
5. **[coder] Feature doc** — write `docs/features/whats-new-digest.md` from the §9.1 outline,
   in the voice of `docs/features/slack-integration.md`. Commit.
6. **[mechanic] Doc one-liners** — the fully specified edits in §9.2–9.4: one line in
   `docs/features.md`, three edits in `docs/setup/slack.md`, one bullet in
   `docs/features/slack-integration.md`. Commit.
7. **[coder] Local smoke + gates** — set `slack_reminder_secret` locally, run the curl in §9.1,
   confirm `[dev → #hub-admin-alerts] *What's new in the hub* …` reaches `#bot-test` (or the
   `[slack:no-token]` log line if no dev token), or `{ posted:false, count:0 }` if nothing merged
   in 7 days (then temporarily widen `now` via a test, not code). Run `./dev npm run lint`,
   `typecheck`, `test`, `e2e`; run `graphify update .`. Commit any fixes, push, `gh pr create`
   with a body listing the two prod prerequisites (`whats_new_url` upsert, `heads-up` label
   creation).
8. **[human, post-merge]** In prod SQL editor: upsert `whats_new_url`; create the `heads-up` label;
   optionally smoke-test with
   `curl -i -XPOST https://hub.redalert1741.org/api/cron/slack/whats-new -H "x-sync-secret: …"`
   (posts a real message to `#hub-admin-alerts`).

Note on spec location: the task suggested `docs/superpowers/whats-new-slack-digest-spec.md`; the
repo convention is `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md`, so this file lives there.
