# Slack Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the hub the ability to send Slack messages (public/private channels, DMs), link hub people to Slack users, alert admins on sync failures, and DM mentors weekly about outstanding FIRST requirements.

**Architecture:** A small `fetch`-based sending library (`src/lib/slack.ts`) with checked-in typed channel/team registries. Non-production sends are redirected to a `#bot-test` channel inside the library so no caller can leak to real channels/DMs. Admin alerts fire on ok↔failing state transitions (state in `app_setting`). User linking reads `users.list` and matches on email; a weekly pg_cron job (same pattern as the existing FIRST/Drive/Calendar syncs) drives mentor reminders. Delivered as three independent PRs.

**Tech Stack:** Next.js (App Router, this repo's forked version), TypeScript, Supabase (Postgres + `app_setting` table, pg_cron/pg_net), vitest, Slack Web API.

**Spec:** `docs/superpowers/specs/2026-08-27-slack-integration-design.md`

## Global Constraints

- **Never run `node`/`npm`/`supabase`/`psql` on the host.** Every command runs in the container via `./dev` (e.g. `./dev npm run test`). App is `localhost:3000` inside the container regardless of worktree port.
- **This is a forked Next.js.** Before writing route/framework code, read the relevant guide in `node_modules/next/dist/docs/`.
- **Migrations are append-only.** Every schema/`app_setting` change is a NEW committed file under `supabase/migrations/` named `<timestamp>_<name>.sql`. Never edit an applied migration. New tables need `grant all on <table> to service_role;` (existing tables like `person`/`app_setting` are already granted — adding a column needs no grant).
- **Secrets go in env vars, not `app_setting`.** `SLACK_BOT_TOKEN` is read from `process.env`. Channel IDs live in the code registry. Cron auth secrets and alert state live in `app_setting`.
- **Production gate is `process.env.VERCEL_ENV === "production"`.** `VERCEL_` is reserved and unforgeable; never gate Slack reach on `NODE_ENV`.
- **Sends must never throw into caller flows.** A Slack outage cannot break a sync. Log and swallow inside the library; expose a boolean where a caller needs the outcome.
- **Commit at each task boundary and push** (`git push`) as commits land. Branch: `slack-integration` (already created).
- Before opening each PR: `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test`, plus `./dev npm run e2e` for the phases that touch routes/UI.

---

# Phase 1 — Slack core + admin alerts (PR 1)

Closes #194, #195, #196. Produces the sending library and wires transition-based failure alerts into the three sync paths. **No migration** (channel IDs are code; alert-state keys are created on demand by `getSetting`'s upsert with an `"ok"` fallback).

## Task 1: Sending library + registries

**Files:**
- Create: `src/lib/slack-registry.ts`
- Create: `src/lib/slack.ts`
- Test: `src/lib/slack.test.ts`

**Interfaces:**
- Produces:
  - `CHANNELS` (const map), `type ChannelName = keyof typeof CHANNELS`
  - `slackTokenFromEnv(): string | null`
  - `type SlackDeps = { fetch: typeof globalThis.fetch; token: string | null; isProd: boolean }`
  - `slackDepsFromEnv(): SlackDeps`
  - `postChannelMessage(deps: SlackDeps, channel: ChannelName, text: string): Promise<boolean>`
  - `sendDM(deps: SlackDeps, slackUserId: string, text: string): Promise<boolean>`

- [ ] **Step 1: Write the registry file**

`src/lib/slack-registry.ts`:

```ts
// Slack channel IDs. Same workspace across all environments, so these are
// identical everywhere and live in code (a typo'd name fails typecheck).
export const CHANNELS = {
  bot_test: "C072BAED43B", // #bot-test — all non-prod sends land here
  hub_alerts: "C0BTB9TMAE8", // #hub-admin-alerts — invite the prod bot once
} as const;
export type ChannelName = keyof typeof CHANNELS;
```

Usergroup mentions (`TEAMS`/`mention`) are intentionally omitted for now — no
usergroup is in use yet, so adding them would be dead code (YAGNI). When a
usergroup reminder is needed, add a `TEAMS` const + `mention(team)` helper in
the same shape and re-add the `mention` test.

- [ ] **Step 2: Write the failing tests**

`src/lib/slack.test.ts` (mirror the `gmail.test.ts` fakeFetch style):

```ts
import { describe, expect, test } from "vitest";
import { CHANNELS } from "./slack-registry";
import { postChannelMessage, sendDM, type SlackDeps } from "./slack";

type CapturedRequest = { url: string; init?: RequestInit };

function fakeFetch(responses: { status: number; body?: unknown }[] = []) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: { ok: true, channel: { id: "D123" } } };
    return new Response(next.body !== undefined ? JSON.stringify(next.body) : undefined, {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, requests };
}

const prodDeps = (fetchFn: typeof globalThis.fetch): SlackDeps => ({ fetch: fetchFn, token: "xoxb-test", isProd: true });
const devDeps = (fetchFn: typeof globalThis.fetch): SlackDeps => ({ fetch: fetchFn, token: "xoxb-test", isProd: false });

function bodyOf(req: CapturedRequest) {
  return JSON.parse(req.init!.body as string) as Record<string, unknown>;
}

describe("postChannelMessage", () => {
  test("posts to chat.postMessage with the resolved channel id and bearer token", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const ok = await postChannelMessage(prodDeps(fetchFn), "hub_alerts", "hello");
    expect(ok).toBe(true);
    const req = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect((req.init?.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
    expect(bodyOf(req).channel).toBe(CHANNELS.hub_alerts);
    expect(bodyOf(req).text).toBe("hello");
  });

  test("non-production redirects the message to bot_test with a preface", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    await postChannelMessage(devDeps(fetchFn), "hub_alerts", "hello");
    const req = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect(bodyOf(req).channel).toBe(CHANNELS.bot_test);
    expect(String(bodyOf(req).text)).toContain("hub_alerts");
    expect(String(bodyOf(req).text)).toContain("hello");
  });

  test("no token → no request, returns false", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await postChannelMessage({ fetch: fetchFn, token: null, isProd: true }, "hub_alerts", "hi");
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("Slack API error (ok:false) is swallowed, returns false", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "channel_not_found" } }]);
    const ok = await postChannelMessage(prodDeps(fetchFn), "hub_alerts", "hi");
    expect(ok).toBe(false);
  });

  test("network throw is swallowed, returns false", async () => {
    const fetchFn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const ok = await postChannelMessage(prodDeps(fetchFn), "hub_alerts", "hi");
    expect(ok).toBe(false);
  });
});

describe("sendDM", () => {
  test("production opens a conversation then posts to the returned channel id", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, channel: { id: "D999" } } }, // conversations.open
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    const ok = await sendDM(prodDeps(fetchFn), "U123", "your items");
    expect(ok).toBe(true);
    expect(requests[0].url).toContain("conversations.open");
    expect(bodyOf(requests[0]).users).toBe("U123");
    expect(requests[1].url).toContain("chat.postMessage");
    expect(bodyOf(requests[1]).channel).toBe("D999");
  });

  test("non-production sends to bot_test instead of opening a DM", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    await sendDM(devDeps(fetchFn), "U123", "your items");
    expect(requests.every((r) => !r.url.includes("conversations.open"))).toBe(true);
    const post = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect(bodyOf(post).channel).toBe(CHANNELS.bot_test);
    expect(String(bodyOf(post).text)).toContain("U123");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./dev npm run test -- src/lib/slack.test.ts`
Expected: FAIL — `slack.ts` has no exports yet.

- [ ] **Step 4: Implement `src/lib/slack.ts`**

```ts
import { CHANNELS, type ChannelName } from "./slack-registry";

const API = "https://slack.com/api/";

export type SlackDeps = {
  fetch: typeof globalThis.fetch;
  token: string | null;
  isProd: boolean;
};

/** Bot token from env; null (⇒ sends become logged no-ops) when unset. */
export function slackTokenFromEnv(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

export function slackDepsFromEnv(): SlackDeps {
  return {
    fetch: globalThis.fetch,
    token: slackTokenFromEnv(),
    // Reserved, unforgeable. Any non-"production" value (preview/dev/unset) is non-prod.
    isProd: process.env.VERCEL_ENV === "production",
  };
}

async function post(deps: SlackDeps, method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await deps.fetch(`${API}${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && body.ok === true, body };
}

/**
 * Post to a channel. In non-production every message is redirected to
 * #bot-test, prefixed with its intended destination — so a dev/preview build
 * can never reach a real channel even with a prod token. Never throws; logs
 * and returns false on any failure.
 */
export async function postChannelMessage(deps: SlackDeps, channel: ChannelName, text: string): Promise<boolean> {
  if (!deps.token) {
    console.log(`[slack:no-token] would post to ${channel}: ${text}`);
    return false;
  }
  const target = deps.isProd ? CHANNELS[channel] : CHANNELS.bot_test;
  const body = deps.isProd ? text : `[dev → #${channel}] ${text}`;
  try {
    const { ok, body: resBody } = await post(deps, "chat.postMessage", { channel: target, text: body });
    if (!ok) console.error(`[slack] chat.postMessage failed:`, resBody.error ?? resBody);
    return ok;
  } catch (e) {
    console.error(`[slack] chat.postMessage threw:`, e);
    return false;
  }
}

/**
 * DM a Slack user (conversations.open → chat.postMessage). In non-production
 * the message is routed to #bot-test instead of opening a real DM. Never
 * throws; returns false on failure.
 */
export async function sendDM(deps: SlackDeps, slackUserId: string, text: string): Promise<boolean> {
  if (!deps.token) {
    console.log(`[slack:no-token] would DM ${slackUserId}: ${text}`);
    return false;
  }
  if (!deps.isProd) {
    try {
      const { ok } = await post(deps, "chat.postMessage", {
        channel: CHANNELS.bot_test,
        text: `[dev → DM ${slackUserId}] ${text}`,
      });
      return ok;
    } catch (e) {
      console.error(`[slack] dev DM redirect threw:`, e);
      return false;
    }
  }
  try {
    const opened = await post(deps, "conversations.open", { users: slackUserId });
    if (!opened.ok) {
      console.error(`[slack] conversations.open failed:`, opened.body.error ?? opened.body);
      return false;
    }
    const channelId = (opened.body.channel as { id?: string } | undefined)?.id;
    if (!channelId) return false;
    const { ok, body } = await post(deps, "chat.postMessage", { channel: channelId, text });
    if (!ok) console.error(`[slack] DM post failed:`, body.error ?? body);
    return ok;
  } catch (e) {
    console.error(`[slack] sendDM threw:`, e);
    return false;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./dev npm run test -- src/lib/slack.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/slack-registry.ts src/lib/slack.ts src/lib/slack.test.ts
git commit -m "feat(slack): fetch-based sending lib with typed registries and non-prod redirect"
git push
```

## Task 2: Transition-based admin alert helper

**Files:**
- Create: `src/lib/slack-alerts.ts`
- Test: `src/lib/slack-alerts.test.ts`

**Interfaces:**
- Consumes: `postChannelMessage`, `slackDepsFromEnv`, `SlackDeps` (Task 1); `getSetting` (`src/lib/settings.ts`); a Supabase client.
- Produces:
  - `type AlertSource = "first_sync" | "calendar_sync" | "drive_sync"`
  - `reportSyncOutcome(source: AlertSource, ok: boolean, opts: { db: SupabaseClient; slack?: SlackDeps; error?: string }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`src/lib/slack-alerts.test.ts` — use an in-memory fake db that records `app_setting` upserts and a spy `SlackDeps`. Cases:

```ts
import { describe, expect, test, vi } from "vitest";
import { reportSyncOutcome } from "./slack-alerts";

// Minimal fake app_setting store honoring getSetting's .select().eq().maybeSingle()
// and .upsert(). Mirror the shape getSetting/first-sync use.
function fakeDb(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    from() {
      return {
        select() {
          return {
            eq(_col: string, key: string) {
              return {
                async maybeSingle() {
                  return store.has(key) ? { data: { value: store.get(key) }, error: null } : { data: null, error: null };
                },
              };
            },
          };
        },
        async upsert(row: { key: string; value: unknown }) {
          store.set(row.key, row.value);
          return { error: null };
        },
      };
    },
  };
}

function spySlack() {
  const posts: { channel: string; text: string }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("chat.postMessage")) {
      posts.push(JSON.parse(init!.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { posts, deps: { fetch: fetchFn, token: "xoxb", isProd: true } };
}

describe("reportSyncOutcome", () => {
  test("ok→failing posts one alert and records failing state", async () => {
    const db = fakeDb({ slack_alert_state_first_sync: "ok" });
    const { posts, deps } = spySlack();
    await reportSyncOutcome("first_sync", false, { db: db as never, slack: deps, error: "session expired" });
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain("session expired");
    expect(db.store.get("slack_alert_state_first_sync")).toBe("failing");
  });

  test("failing→failing posts nothing (no repeat spam)", async () => {
    const db = fakeDb({ slack_alert_state_first_sync: "failing" });
    const { posts, deps } = spySlack();
    await reportSyncOutcome("first_sync", false, { db: db as never, slack: deps, error: "still down" });
    expect(posts).toHaveLength(0);
  });

  test("failing→ok posts a recovery note and records ok", async () => {
    const db = fakeDb({ slack_alert_state_calendar_sync: "failing" });
    const { posts, deps } = spySlack();
    await reportSyncOutcome("calendar_sync", true, { db: db as never, slack: deps });
    expect(posts).toHaveLength(1);
    expect(posts[0].text.toLowerCase()).toContain("recover");
    expect(db.store.get("slack_alert_state_calendar_sync")).toBe("ok");
  });

  test("ok→ok (default state) posts nothing", async () => {
    const db = fakeDb();
    const { posts, deps } = spySlack();
    await reportSyncOutcome("drive_sync", true, { db: db as never, slack: deps });
    expect(posts).toHaveLength(0);
    expect(db.store.get("slack_alert_state_drive_sync")).toBe("ok");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./dev npm run test -- src/lib/slack-alerts.test.ts`
Expected: FAIL — no `slack-alerts.ts`.

- [ ] **Step 3: Implement `src/lib/slack-alerts.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "./settings";
import { postChannelMessage, slackDepsFromEnv, type SlackDeps } from "./slack";

export type AlertSource = "first_sync" | "calendar_sync" | "drive_sync";

const LABELS: Record<AlertSource, string> = {
  first_sync: "FIRST roster sync",
  calendar_sync: "Google Calendar sync",
  drive_sync: "Google Drive group sync",
};

/**
 * Post an admin alert to #hub_alerts only when a sync's health CHANGES
 * (ok→failing or failing→ok). Last-known state per source lives in
 * app_setting.slack_alert_state_<source> (default "ok"). This prevents the
 * every-15-min FIRST sync from posting ~96 alerts/day during an outage.
 * Never throws — alerting must not break the sync that called it.
 */
export async function reportSyncOutcome(
  source: AlertSource,
  ok: boolean,
  opts: { db: SupabaseClient; slack?: SlackDeps; error?: string },
): Promise<void> {
  try {
    const key = `slack_alert_state_${source}`;
    const prev = await getSetting<"ok" | "failing">(key, "ok", opts.db);
    const next = ok ? "ok" : "failing";
    if (prev === next) return;

    const slack = opts.slack ?? slackDepsFromEnv();
    const text = ok
      ? `:white_check_mark: ${LABELS[source]} recovered — syncing normally again.`
      : `:rotating_light: ${LABELS[source]} is failing.${opts.error ? `\n\`\`\`${opts.error}\`\`\`` : ""}`;
    await postChannelMessage(slack, "hub_alerts", text);

    await opts.db.from("app_setting").upsert({ key, value: next }, { onConflict: "key" });
  } catch (e) {
    console.error(`[slack-alerts] reportSyncOutcome(${source}) threw:`, e);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./dev npm run test -- src/lib/slack-alerts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slack-alerts.ts src/lib/slack-alerts.test.ts
git commit -m "feat(slack): transition-based sync-failure alert helper"
git push
```

## Task 3: Wire alerts into the three sync paths

**Files:**
- Modify: `src/app/api/admin/calendar/sync/route.ts`
- Modify: `src/app/api/admin/drive-group/sync/route.ts`
- Modify: `src/app/api/admin/first/sync/route.ts`
- Test: extend/confirm existing route behavior (see step 1)

**Interfaces:**
- Consumes: `reportSyncOutcome`, `AlertSource` (Task 2).

The three routes share a shape: success returns `Response.json(result)`, failure is caught and returns 502 (calendar/drive) or is otherwise observable (first). Wrap each outcome with `reportSyncOutcome` so the success path reports `ok` and the failure path reports `failing` with the error text.

- [ ] **Step 1: Locate the first-sync route's outcome handling**

Run: `./dev bash -lc "cat src/app/api/admin/first/sync/route.ts"`
Note how it calls `syncFirstRoster` and how the `session_expired` / thrown-error cases surface. The alert must fire `failing` on both a thrown error and a returned `report.error === "session_expired"`.

- [ ] **Step 2: Edit the calendar route**

In `src/app/api/admin/calendar/sync/route.ts`, import the helper and wrap the try/catch:

```ts
import { reportSyncOutcome } from "@/lib/slack-alerts";
// ...
  try {
    const result = await syncCalendar({ fetch: globalThis.fetch, db, credentials, tz });
    await reportSyncOutcome("calendar_sync", true, { db });
    return Response.json(result);
  } catch (e) {
    console.error("calendar sync failed:", e);
    await reportSyncOutcome("calendar_sync", false, { db, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
```

- [ ] **Step 3: Edit the drive-group route**

Same edit in `src/app/api/admin/drive-group/sync/route.ts` with `"drive_sync"`:

```ts
import { reportSyncOutcome } from "@/lib/slack-alerts";
// ...
  try {
    const result = await reconcileDriveGroups({ fetch: globalThis.fetch, db, credentials });
    await reportSyncOutcome("drive_sync", true, { db });
    return Response.json(result);
  } catch (e) {
    console.error("drive-group sync failed:", e);
    await reportSyncOutcome("drive_sync", false, { db, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
```

- [ ] **Step 4: Edit the first-sync route**

In `src/app/api/admin/first/sync/route.ts`, report `failing` on both the thrown-error catch and the `session_expired` report, `ok` otherwise. Concretely, wherever `syncFirstRoster` is awaited:

```ts
import { reportSyncOutcome } from "@/lib/slack-alerts";
// ...
  try {
    const report = await syncFirstRoster({ db });
    await reportSyncOutcome("first_sync", report.error !== "session_expired", {
      db,
      error: report.error === "session_expired" ? "FIRST session expired — re-paste a fresh cookie." : undefined,
    });
    return Response.json(report);
  } catch (e) {
    await reportSyncOutcome("first_sync", false, { db, error: e instanceof Error ? e.message : String(e) });
    // preserve whatever the existing error response was
    throw e;
  }
```
Adapt to the route's actual existing structure (keep its current status codes / response body; only add the two `reportSyncOutcome` calls).

- [ ] **Step 5: Typecheck + run the full suite**

Run: `./dev npm run typecheck && ./dev npm run test`
Expected: PASS. (No Slack token in test env ⇒ alert posts are no-ops; the transition logic is already covered in Task 2.)

- [ ] **Step 6: Manual smoke (optional but recommended)**

With the dev bot token in `.env` and real IDs in the registry, force a calendar-sync failure (e.g. temporarily bad calendar id) twice and confirm exactly one `#bot-test` alert, then a fix and one recovery note.

- [ ] **Step 7: Commit + open PR 1**

```bash
git add src/app/api/admin/calendar/sync/route.ts src/app/api/admin/drive-group/sync/route.ts src/app/api/admin/first/sync/route.ts
git commit -m "feat(slack): alert admins on FIRST/calendar/drive sync failure and recovery (#194 #195 #196)"
git push
```
Then before the PR: `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run e2e`, then `gh pr create`. Report the URL.

---

# Phase 2 — Person ↔ Slack linking (PR 2)

Adds `person.slack_user_id`, a `users.list` email-match sync, an admin page with a Sync button + unmatched report, and manual link/unlink controls.

## Task 4: Migration — `person.slack_user_id`

**Files:**
- Create: `supabase/migrations/<timestamp>_person_slack_user_id.sql`

- [ ] **Step 1: Write the migration**

Generate a timestamp newer than `20260827120000`. File contents:

```sql
-- Link a hub person to their Slack user id (v1: read/match from users.list).
-- person is already granted to service_role; a new column needs no grant.
alter table person add column if not exists slack_user_id text unique;
```

- [ ] **Step 2: Apply locally and confirm**

Run: `./dev npm run db:reset`
Expected: reset completes with no error; the new column exists (`./dev bash -lc "psql \"$DATABASE_URL\" -c '\\d person' | grep slack_user_id"` or check Supabase Studio).

- [ ] **Step 3: Regenerate DB types if the repo commits them**

Run: `./dev bash -lc "grep -rl 'slack_user_id\|first_people_id' src/lib/database.types.ts 2>/dev/null"` — if a generated types file exists, regenerate it per the repo's usual command (check `package.json` scripts for `gen:types`/`db:types`); otherwise skip.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ src/lib/database.types.ts
git commit -m "feat(slack): add person.slack_user_id column"
git push
```

## Task 5: `users.list` email-match sync library

**Files:**
- Create: `src/lib/slack-link.ts`
- Test: `src/lib/slack-link.test.ts`

**Interfaces:**
- Consumes: `SlackDeps` (Task 1); a Supabase client.
- Produces:
  - `type SlackMember = { id: string; email: string }`
  - `fetchSlackMembers(deps: SlackDeps): Promise<SlackMember[]>` — paginates `users.list`, filters out deleted/bot/unconfirmed/restricted, lowercases emails.
  - `type LinkReport = { linked: number; alreadyLinked: number; ambiguous: { email: string; personIds: string[] }[]; unmatchedSlack: SlackMember[]; unmatchedPeople: { personId: string; name: string }[] }`
  - `syncSlackLinks(deps: { db: SupabaseClient; slack: SlackDeps }): Promise<LinkReport>`

- [ ] **Step 1: Write the failing tests**

`src/lib/slack-link.test.ts`. Cover, with fakeFetch queuing `users.list` pages and a fake db exposing `person`/`person_identity` selects + `person` update:

- `fetchSlackMembers` filters deleted/bot/`is_restricted`/`is_ultra_restricted`/`is_email_confirmed === false` and drops members with no email; follows `response_metadata.next_cursor` for a second page.
- `syncSlackLinks` links a member whose email matches `person.email` (case-insensitive).
- links a member whose email matches a `person_identity.email` but not `person.email`.
- a member email matching two different people → `ambiguous`, no write.
- a member already linked to the same person → counted `alreadyLinked`, no redundant write.
- members matching nobody → `unmatchedSlack`; people with no matching member → `unmatchedPeople`.

Use the fakeFetch pattern from Task 1 and a fake db in the `slack-alerts.test.ts` style, extended with `.in()`/`.update().eq()`.

- [ ] **Step 2: Run to verify failure**

Run: `./dev npm run test -- src/lib/slack-link.test.ts`
Expected: FAIL — no `slack-link.ts`.

- [ ] **Step 3: Implement `src/lib/slack-link.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SlackDeps } from "./slack";

const API = "https://slack.com/api/";

export type SlackMember = { id: string; email: string };

type RawMember = {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  profile?: { email?: string | null };
  // Slack sets is_email_confirmed on the member; treat missing as confirmed.
  is_email_confirmed?: boolean;
};

/** Fetch active human members with confirmed emails, following pagination. */
export async function fetchSlackMembers(deps: SlackDeps): Promise<SlackMember[]> {
  if (!deps.token) return [];
  const out: SlackMember[] = [];
  let cursor = "";
  do {
    const url = `${API}users.list?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${deps.token}` } });
    const body = (await res.json()) as {
      ok: boolean;
      members?: RawMember[];
      response_metadata?: { next_cursor?: string };
    };
    if (!body.ok) throw new Error(`slack users.list failed: ${JSON.stringify(body)}`);
    for (const m of body.members ?? []) {
      if (m.deleted || m.is_bot || m.is_restricted || m.is_ultra_restricted) continue;
      if (m.is_email_confirmed === false) continue;
      const email = m.profile?.email?.trim().toLowerCase();
      if (!email) continue;
      out.push({ id: m.id, email });
    }
    cursor = body.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return out;
}

/**
 * Match Slack members to hub people by email (person.email + person_identity.email,
 * case-insensitive) and write person.slack_user_id on unambiguous matches.
 * Emails resolving to more than one person are reported, not written.
 */
export async function syncSlackLinks(deps: { db: SupabaseClient; slack: SlackDeps }): Promise<LinkReport> {
  const { db } = deps;
  const members = await fetchSlackMembers(deps.slack);

  const { data: personRows, error: pErr } = await db
    .from("person")
    .select("id, first_name, last_name, display_name, email, slack_user_id, is_active");
  if (pErr) throw new Error(`slack-link: load person failed: ${pErr.message}`);
  const people = (personRows ?? []) as {
    id: string; first_name: string; last_name: string; display_name: string | null;
    email: string | null; slack_user_id: string | null; is_active: boolean;
  }[];

  const { data: identRows, error: iErr } = await db.from("person_identity").select("person_id, email");
  if (iErr) throw new Error(`slack-link: load person_identity failed: ${iErr.message}`);

  // email(lowercase) -> set of personIds
  const byEmail = new Map<string, Set<string>>();
  const add = (email: string | null | undefined, personId: string) => {
    if (!email) return;
    const key = email.trim().toLowerCase();
    (byEmail.get(key) ?? byEmail.set(key, new Set()).get(key)!).add(personId);
  };
  for (const p of people) add(p.email, p.id);
  for (const row of (identRows ?? []) as { person_id: string; email: string }[]) add(row.email, row.person_id);

  const linkedByPerson = new Map(people.map((p) => [p.id, p.slack_user_id]));
  const report: LinkReport = { linked: 0, alreadyLinked: 0, ambiguous: [], unmatchedSlack: [], unmatchedPeople: [] };
  const matchedPeople = new Set<string>();

  for (const m of members) {
    const ids = byEmail.get(m.email);
    if (!ids || ids.size === 0) { report.unmatchedSlack.push(m); continue; }
    if (ids.size > 1) { report.ambiguous.push({ email: m.email, personIds: [...ids] }); continue; }
    const personId = [...ids][0];
    matchedPeople.add(personId);
    if (linkedByPerson.get(personId) === m.id) { report.alreadyLinked++; continue; }
    const { error } = await db.from("person").update({ slack_user_id: m.id }).eq("id", personId);
    if (error) throw new Error(`slack-link: update ${personId} failed: ${error.message}`);
    report.linked++;
  }

  report.unmatchedPeople = people
    .filter((p) => p.is_active && !p.slack_user_id && !matchedPeople.has(p.id))
    .map((p) => ({ personId: p.id, name: p.display_name ?? `${p.first_name} ${p.last_name}` }));

  return report;
}

export type LinkReport = {
  linked: number;
  alreadyLinked: number;
  ambiguous: { email: string; personIds: string[] }[];
  unmatchedSlack: SlackMember[];
  unmatchedPeople: { personId: string; name: string }[];
};
```

- [ ] **Step 4: Run to verify pass**

Run: `./dev npm run test -- src/lib/slack-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slack-link.ts src/lib/slack-link.test.ts
git commit -m "feat(slack): users.list email-match linking library"
git push
```

## Task 6: Link-sync route + admin page

**Files:**
- Create: `src/app/api/admin/slack/link-sync/route.ts`
- Create: `src/app/admin/slack/page.tsx`
- Create: `src/components/SlackLinkPanel.tsx`
- Modify: `src/app/admin/page.tsx` (add a nav Card)

**Interfaces:**
- Consumes: `syncSlackLinks`, `LinkReport` (Task 5); `slackDepsFromEnv` (Task 1); `getViewer`/`hasRole` (auth).

- [ ] **Step 1: Write the route** (`src/app/api/admin/slack/link-sync/route.ts`)

Follow the drive-group route's dual-gate exactly, but this action is admin-triggered only (no cron), so a single admin-session gate suffices:

```ts
import { getDb } from "@/lib/db";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { slackDepsFromEnv } from "@/lib/slack";
import { syncSlackLinks } from "@/lib/slack-link";

export async function POST() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) return Response.json({ error: "forbidden" }, { status: 403 });

  const slack = slackDepsFromEnv();
  if (!slack.token) return Response.json({ error: "not_configured", have: { token: false } }, { status: 400 });

  try {
    const report = await syncSlackLinks({ db: getDb(), slack });
    return Response.json(report);
  } catch (e) {
    console.error("slack link-sync failed:", e);
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Write the panel** (`src/components/SlackLinkPanel.tsx`)

Model on `DriveSyncPanel.tsx` — a `"use client"` button posting to `/api/admin/slack/link-sync`, showing `linked`/`alreadyLinked`/`ambiguous`/`unmatched` counts and lists on the returned `LinkReport`. On success call `router.refresh()`.

- [ ] **Step 3: Write the admin page** (`src/app/admin/slack/page.tsx`)

Model on `src/app/admin/drive-sync/page.tsx`: admin-gate + `redirect("/")`, render a "Slack linking" heading, the `SlackLinkPanel`, and (server-side) a table of currently linked people (`person.slack_user_id is not null`) and unlinked active mentors/admins for at-a-glance status.

- [ ] **Step 4: Add the nav card** in `src/app/admin/page.tsx` near the other integration cards (after the FIRST status card, line ~182):

```tsx
<Card href="/admin/slack" icon="users" title="Slack" hint="Link people to Slack users and sync from the workspace." />
```

- [ ] **Step 5: Verify in the browser**

Run the stack; visit `http://localhost:$APP_PORT/admin/slack` (dev-login as Admin). With no token, the panel shows the `not_configured` message; with the dev token, "Sync now" returns a report. Confirm typecheck: `./dev npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/slack/link-sync/route.ts src/app/admin/slack/page.tsx src/components/SlackLinkPanel.tsx src/app/admin/page.tsx
git commit -m "feat(slack): admin linking page with users.list sync (#80)"
git push
```

## Task 7: Manual link / unlink control

**Files:**
- Create: `src/app/api/admin/people/[id]/slack/route.ts`
- Create: `src/components/PersonSlackLink.tsx`
- Modify: `src/app/admin/people/[id]/page.tsx` (add a section)

**Interfaces:**
- Consumes: `getViewer`/`hasRole`, `getDb`.
- Produces: `PUT`/`DELETE` on `/api/admin/people/[id]/slack` setting/clearing `person.slack_user_id`.

- [ ] **Step 1: Write the route**

`src/app/api/admin/people/[id]/slack/route.ts` — admin-gated. `PUT` body `{ slackUserId: string }` writes `person.slack_user_id` (validate non-empty, trim; 409 on unique violation `23505` — that Slack id is linked elsewhere). `DELETE` sets it to `null`. Match the param-handling signature this Next.js fork uses (check a sibling route under `src/app/api/admin/people/[id]/`).

- [ ] **Step 2: Write the client control** (`src/components/PersonSlackLink.tsx`)

`"use client"`: shows current `slackUserId` (or "not linked"), a text input + Save (PUT) and an Unlink button (DELETE), `router.refresh()` on success, inline error on 409/others. Mirror the compactness of `PersonEmails.tsx`.

- [ ] **Step 3: Render it on the person page**

In `src/app/admin/people/[id]/page.tsx`, load `slack_user_id` (extend the existing person select if needed) and add a section after the `PersonEmails` section (~line 66-82):

```tsx
<section className="card flex flex-col gap-3">
  <h2 className="text-base font-semibold">Slack</h2>
  <PersonSlackLink personId={result.person.id} slackUserId={result.person.slack_user_id ?? null} />
</section>
```
(Adapt `result.person` to the page's actual variable for the loaded person.)

- [ ] **Step 4: Verify + typecheck**

Visit an admin person page, link a fake `U…` id, save, reload, unlink. `./dev npm run typecheck`.

- [ ] **Step 5: Commit + open PR 2**

```bash
git add src/app/api/admin/people/ src/components/PersonSlackLink.tsx src/app/admin/people/
git commit -m "feat(slack): manual link/unlink control on the person page (#80)"
git push
```
Then `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run e2e`, `gh pr create`, report URL.

---

# Phase 3 — Weekly mentor reminders (PR 3)

Closes #191. A weekly pg_cron job hits a secret-gated endpoint that DMs each linked mentor with outstanding FIRST requirements and posts a summary (including who's unlinked) to `#hub_alerts`.

## Task 8: Reminder computation + send library

**Files:**
- Create: `src/lib/mentor-reminders.ts`
- Test: `src/lib/mentor-reminders.test.ts`

**Interfaces:**
- Consumes: `sendDM`, `postChannelMessage`, `SlackDeps` (Task 1); Supabase client.
- Produces:
  - `type MentorReq = { personId: string; name: string; slackUserId: string | null; consent: boolean | null; screeningStatus: string | null; trainingStatus: string | null }`
  - `outstandingItems(m: MentorReq): string[]` — PURE; the human-readable list of what's incomplete.
  - `buildReminderText(name: string, items: string[]): string` — PURE.
  - `sendMentorReminders(deps: { db: SupabaseClient; slack: SlackDeps; sleep?: (ms: number) => Promise<void> }): Promise<{ reminded: number; unlinked: string[]; complete: number }>`

- [ ] **Step 1: Write the failing tests** (`src/lib/mentor-reminders.test.ts`)

Cover `outstandingItems` (PURE) and `sendMentorReminders`:

```ts
import { describe, expect, test } from "vitest";
import { outstandingItems, buildReminderText, sendMentorReminders, type MentorReq } from "./mentor-reminders";

describe("outstandingItems", () => {
  const base: MentorReq = { personId: "p", name: "M", slackUserId: "U", consent: true, screeningStatus: "green", trainingStatus: "green" };
  test("fully complete → empty", () => {
    expect(outstandingItems(base)).toEqual([]);
  });
  test("missing consent is listed", () => {
    expect(outstandingItems({ ...base, consent: false })).toContain("Consent & release form");
  });
  test("non-green screening is listed", () => {
    expect(outstandingItems({ ...base, screeningStatus: "blue" })).toContain("Youth Protection screening");
  });
  test("non-green training is listed", () => {
    expect(outstandingItems({ ...base, trainingStatus: null })).toContain("Required training");
  });
  test("never-synced (all null) lists everything", () => {
    expect(outstandingItems({ ...base, consent: null, screeningStatus: null, trainingStatus: null })).toHaveLength(3);
  });
});

describe("sendMentorReminders", () => {
  test("DMs only linked incomplete mentors, reports unlinked by name, skips complete", async () => {
    // fake db returns 3 mentors: A linked+incomplete, B unlinked+incomplete, C linked+complete
    // spy slack records DMs + the summary channel post
    // assert: reminded === 1; unlinked === ["B Name"]; complete === 1
    // assert the summary post text contains "B Name" and channel is hub_alerts (bot_test in test)
  });
});
```
Fill the `sendMentorReminders` test body using the fake-db + spy-slack helpers from earlier tasks; pass `sleep: async () => {}` so the test doesn't wait. Assert DM count, that C got no DM, and the summary names B.

- [ ] **Step 2: Run to verify failure**

Run: `./dev npm run test -- src/lib/mentor-reminders.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Implement `src/lib/mentor-reminders.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { postChannelMessage, sendDM, type SlackDeps } from "./slack";

export type MentorReq = {
  personId: string;
  name: string;
  slackUserId: string | null;
  consent: boolean | null;
  screeningStatus: string | null;
  trainingStatus: string | null;
};

// ponytail: "green" = satisfied for screening/training, matching the values the
// FIRST sync currently stores (see first-sync.ts screeningStatus comment and
// the first-status page). Confirm against real synced data before prod; widen
// this set here if FIRST reports another passing value.
const SATISFIED = new Set(["green"]);

/** Human-readable list of a mentor's still-outstanding FIRST requirements. PURE. */
export function outstandingItems(m: MentorReq): string[] {
  const items: string[] = [];
  if (m.consent !== true) items.push("Consent & release form");
  if (!m.screeningStatus || !SATISFIED.has(m.screeningStatus)) items.push("Youth Protection screening");
  if (!m.trainingStatus || !SATISFIED.has(m.trainingStatus)) items.push("Required training");
  return items;
}

export function buildReminderText(name: string, items: string[]): string {
  const lines = items.map((i) => `  • ${i}`).join("\n");
  return `Hi ${name}! You still have outstanding FIRST requirements:\n${lines}\n\nPlease complete them at https://my.firstinspires.org — thanks!`;
}

/**
 * DM every LINKED mentor who has outstanding FIRST requirements their specific
 * list, paced to respect Slack rate limits, and post one summary to #hub_alerts
 * that names any incomplete mentor who couldn't be DMed (no Slack link).
 */
export async function sendMentorReminders(deps: {
  db: SupabaseClient;
  slack: SlackDeps;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ reminded: number; unlinked: string[]; complete: number }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const { data, error } = await deps.db
    .from("person")
    .select("id, first_name, last_name, display_name, slack_user_id, first_consent_release, first_screening_status, first_training_status, first_people_id")
    .in("role", ["mentor", "admin"])
    .eq("is_active", true);
  if (error) throw new Error(`mentor-reminders: load person failed: ${error.message}`);

  const mentors: MentorReq[] = (data ?? []).map((p: Record<string, unknown>) => ({
    personId: p.id as string,
    name: (p.display_name as string | null) ?? `${p.first_name} ${p.last_name}`,
    slackUserId: (p.slack_user_id as string | null) ?? null,
    // Never synced (no first_people_id) ⇒ treat as unknown/null, i.e. incomplete.
    consent: p.first_people_id == null ? null : ((p.first_consent_release as boolean | null) ?? null),
    screeningStatus: (p.first_screening_status as string | null) ?? null,
    trainingStatus: (p.first_training_status as string | null) ?? null,
  }));

  let reminded = 0;
  let complete = 0;
  const unlinked: string[] = [];

  for (const m of mentors) {
    const items = outstandingItems(m);
    if (items.length === 0) { complete++; continue; }
    if (!m.slackUserId) { unlinked.push(m.name); continue; }
    const ok = await sendDM(deps.slack, m.slackUserId, buildReminderText(m.name, items));
    if (ok) reminded++;
    await sleep(1100); // ~1 msg/sec
  }

  const summary =
    `:memo: Weekly FIRST reminder run — DMed ${reminded} mentor(s); ${complete} fully complete.` +
    (unlinked.length ? `\n:warning: No Slack link (not reminded): ${unlinked.join(", ")}` : "");
  await postChannelMessage(deps.slack, "hub_alerts", summary);

  return { reminded, unlinked, complete };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `./dev npm run test -- src/lib/mentor-reminders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mentor-reminders.ts src/lib/mentor-reminders.test.ts
git commit -m "feat(slack): mentor FIRST-requirement reminder computation and send (#191)"
git push
```

## Task 9: Cron endpoint + schedule migration

**Files:**
- Create: `src/app/api/cron/slack/mentor-reminders/route.ts`
- Create: `supabase/migrations/<timestamp>_slack_mentor_reminders_cron.sql`

**Interfaces:**
- Consumes: `sendMentorReminders` (Task 8); `getSetting`, `secureEqual`.

- [ ] **Step 1: Write the route** (`src/app/api/cron/slack/mentor-reminders/route.ts`)

Secret-gated like the sync routes (this one is cron-only, so secret is required — no session fallback):

```ts
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { sendMentorReminders } from "@/lib/mentor-reminders";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_reminder_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await sendMentorReminders({ db, slack: slackDepsFromEnv() });
    return Response.json(result);
  } catch (e) {
    console.error("mentor reminders failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Write the migration** (copy the FIRST/Drive cron pattern verbatim)

```sql
-- Weekly mentor FIRST-requirement reminders via pg_net → the app endpoint.
-- URL + secret read from app_setting AT RUN TIME (set per-env; empty secret
-- never authorizes). Same pattern as first-nightly-sync / drive-group sync.
insert into app_setting (key, value) values
  ('slack_reminder_secret', '""'),
  ('slack_reminder_url', '"http://host.docker.internal:3000/api/cron/slack/mentor-reminders"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'slack-mentor-reminders-weekly',
  '0 14 * * 1',  -- Mondays 14:00 UTC ≈ 9-10am team-local (America/Indiana)
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'slack_reminder_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'slack_reminder_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

- [ ] **Step 3: Apply + smoke the endpoint**

Run: `./dev npm run db:reset`
Set a dev secret: in Supabase Studio (or `app-settings-admin`), set `slack_reminder_secret` to a test value, then:
`./dev bash -lc 'curl -s -X POST localhost:3000/api/cron/slack/mentor-reminders -H "x-sync-secret: <value>"'`
Expected: JSON `{ reminded, unlinked, complete }`; with the dev bot token, a summary lands in `#bot-test`. Wrong/empty secret → 403.

- [ ] **Step 4: Typecheck + full suite**

Run: `./dev npm run typecheck && ./dev npm run test`
Expected: PASS.

- [ ] **Step 5: Commit + open PR 3**

```bash
git add src/app/api/cron/slack/mentor-reminders/route.ts supabase/migrations/
git commit -m "feat(slack): weekly mentor FIRST-requirement reminder cron (#191)"
git push
```
Then `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run e2e`, `gh pr create`, report URL.

---

## Post-implementation (manual, outside the plan)

These are one-time operational steps, not code — do them as the PRs merge:

1. **Create the two Slack apps** from `slack/manifest.yml` (a manifest file is worth adding in PR 1 if convenient; otherwise configure in the Slack UI). Scopes: `chat:write`, `chat:write.public`, `im:write`, `users:read`, `users:read.email`. Verify exact scope names against Slack docs.
2. **Fill real IDs** into `src/lib/slack-registry.ts` (`bot_test`, `hub_alerts` channel IDs; `mentors` usergroup id) and invite the prod bot to the private `hub_alerts` channel; invite the dev bot only to `#bot-test`.
3. **Set env + settings per environment:** `SLACK_BOT_TOKEN` (dev token locally, prod token in Vercel production env); set `slack_reminder_secret` and the `*_url` app_settings to the production URL in prod (they default to the docker-host dev URL).
4. **Confirm the `SATISFIED` training/screening values** (Task 8) against real synced FIRST data before trusting the reminder contents.

---

## Self-review notes

- **Spec coverage:** sending lib + registries (Task 1) ✓; non-prod redirect / no-token no-op (Task 1) ✓; transition-based alerts #194/195/196 (Tasks 2–3) ✓; `slack_user_id` + email-match sync + manual link (Tasks 4–7) ✓; weekly reminders #191 (Tasks 8–9) ✓; v2 invite-link + slash commands explicitly deferred (spec non-goals, not planned) ✓.
- **No migration in Phase 1** is intentional: channels are code, alert state is created on demand via `getSetting` fallback.
- **Type consistency:** `SlackDeps` shape is identical across Tasks 1/2/5/8; `LinkReport` defined in Task 5 and consumed in Task 6; `MentorReq`/`outstandingItems` names consistent Task 8↔tests.
- **Known corner (flagged, not hidden):** the `SATISFIED = {"green"}` set is a documented assumption to verify against live FIRST data (post-impl step 4).
