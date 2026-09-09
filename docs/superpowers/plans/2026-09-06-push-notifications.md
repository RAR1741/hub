# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver browser Web Push notifications for five notification types on one shared VAPID pipeline, every type off by default.

**Architecture:** One shared dispatcher (`sendPushToOptedIn`) owns VAPID/encryption/delivery/pruning. Each of the five types is a thin caller that computes recipients, filters by opt-in, builds a payload, and hands it to the core. PWA plumbing (service worker + manifest) is added because Web Push requires a service worker. All state changes go through POST/PATCH routes gated by `withRole`; the two new crons follow the existing pg_net → app-endpoint + `x-sync-secret` pattern.

**Tech Stack:** Next.js App Router (this repo's breaking-changes build — read `node_modules/next/dist/docs/` before writing any App Router code), TypeScript, Supabase (service-role client, RLS + zero policies), `web-push` (new dep), pg_cron + pg_net, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-06-push-notifications-design.md](../specs/2026-09-06-push-notifications-design.md)

## Global Constraints

- **Everything runs in Docker.** Never run `node`/`npm`/`supabase` on the host. Use `./dev npm run …`. In-container the app is `localhost:3000`; host ports are per-worktree.
- **Off by default.** `person.notification_types` defaults to `'{}'`. No type is ever on until the person toggles it. Enabling push on a device and toggling a type are two separate steps.
- **CSRF = `sameSite=lax` only.** Never make a GET/HEAD handler mutate state. Every mutation is POST/PATCH/PUT/DELETE.
- **New tables need a `service_role` GRANT.** RLS enabled, zero policies. `grant all on <table> to service_role;` or every query 42501s on a fresh DB. Never add RLS policies to data tables.
- **Migrations are immutable once applied.** A correction is a NEW migration file. **Before naming any migration, run `git fetch origin -q && git ls-tree -r --name-only origin/master -- supabase/migrations/ | sort | tail -3`** and pick a timestamp strictly after the newest — parallel worktrees collide on timestamps. The names in this plan (`20260906*`) assume `origin/master` tops out at `20260904120000`; re-verify.
- **Container Supabase seam:** server code resolves the Supabase URL via `serverSupabaseUrl()` (`src/lib/supabase-url.ts`), never a hardcoded URL. (Web Push does not touch Supabase URLs — it POSTs to push services — but any DB access uses the service-role `getDb()`.)
- **Routes gated by `withRole` need no `route-auth-allowlist` entry.** Secret-gated cron routes DO — add them to `ROUTE_AUTH_ALLOWLIST` in `src/app/route-auth-allowlist.test.ts`.
- **Team timezone** is `America/Indiana/Indianapolis` (Eastern). pg_cron runs in UTC and cannot call app helpers.
- **Auto-close sweep** `close-stale-sessions` runs `0 8 * * *` (08:00 UTC). The `clocked_in_late` nudge must fire before it.
- **VAPID env vars (three):** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public, read client- AND server-side), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`). Rotating keys invalidates every subscription.
- **Commit at each task; push after every commit** (`git push` to `origin/push-notifications`). Run `graphify update .` after code changes.
- Before opening the PR: `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run e2e` must pass.

---

## File Structure

**New files:**
- `supabase/migrations/20260906120000_push_notifications.sql` — table, columns, grant, shared cron secret row.
- `supabase/migrations/20260906120100_push_clocked_in_late_cron.sql` — pg_cron schedule.
- `supabase/migrations/20260906120200_push_meeting_reminder_cron.sql` — pg_cron schedule.
- `src/lib/notification-types.ts` — `NotificationType` union, labels, role availability. PURE.
- `src/lib/push-dispatch.ts` — `sendPushToOptedIn`, `pushDepsFromEnv`, `sanitizePushText`.
- `src/lib/admin-notify.ts` — `notifyAdmins` (Slack + admin push, returns Slack's boolean).
- `public/sw.js` — static service worker (push + notificationclick).
- `app/manifest.ts` — web app manifest. (Path is `src/app/manifest.ts` — this repo keeps `app/` under `src/`; confirm by where `src/app/layout.tsx` lives.)
- `src/app/api/push/subscribe/route.ts`, `src/app/api/push/unsubscribe/route.ts` — subscription CRUD.
- `src/app/api/notifications/prefs/route.ts` — per-type toggle.
- `src/app/api/cron/push/clocked-in-late/route.ts`, `src/app/api/cron/push/meeting-reminder/route.ts` — crons.
- `src/app/me/notifications/page.tsx` + a client component for the subscribe flow.
- `docs/setup/web-push.md`, `docs/features/push-notifications.md`.
- Test files alongside each (`*.test.ts`) + `e2e/notifications.spec.ts`.

**Modified files:**
- `src/lib/slack-alerts.ts` — call `notifyAdmins` instead of `postChannelMessage`.
- `src/lib/mentor-reminders.ts` — call `notifyAdmins` for the summary; add `consent_missing` push in the per-mentor loop.
- `src/lib/meetings.ts` — `meeting_changed` push + `reminder_pushed_at` reset in `updateMeeting`.
- `src/lib/gcal.ts` — `meeting_changed` push + `reminder_pushed_at` reset at the meeting upsert.
- `src/app/layout.tsx` — `appleWebApp` metadata.
- `src/app/route-auth-allowlist.test.ts` — two cron entries.
- The home dashboard page — mount the dismissible card.
- `.env.example`, `docs/features.md`.

---

## Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/20260906120000_push_notifications.sql`

**Interfaces:**
- Produces: table `push_subscription (id, person_id, endpoint unique, p256dh, auth, user_agent, created_at, last_used_at)`; column `person.notification_types text[] not null default '{}'`; column `meeting.reminder_pushed_at timestamptz`; `app_setting` row `push_cron_secret` (default `'""'`).

- [ ] **Step 1: Verify the timestamp is free**

Run: `git fetch origin -q && git ls-tree -r --name-only origin/master -- supabase/migrations/ | sort | tail -3`
Expected: newest is `20260904120000_team_slack_channel.sql` (or older). If a `20260906*` already exists, bump the timestamp for all three migrations in this plan.

- [ ] **Step 2: Write the migration**

```sql
-- Web Push: device subscriptions, per-person opt-in list, meeting reminder
-- dedupe marker, and the shared cron secret. All types are OFF by default
-- (notification_types defaults to empty).

create table push_subscription (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references person (id) on delete cascade,
  endpoint     text not null unique,   -- push service URL (also the natural key)
  p256dh       text not null,          -- client public key (base64url)
  auth         text not null,          -- client auth secret (base64url)
  user_agent   text,                   -- device list / debugging
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscription_person_idx on push_subscription (person_id);

alter table push_subscription enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on push_subscription to service_role;

-- Per-person opt-in list. Empty = every type off (the default).
alter table person add column notification_types text[] not null default '{}';

-- Dedupe marker so the meeting-reminder cron reminds each meeting once.
alter table meeting add column reminder_pushed_at timestamptz;

-- Shared secret for both push crons; set per-env in prod (empty never authorizes).
insert into app_setting (key, value) values ('push_cron_secret', '""')
on conflict (key) do nothing;
```

- [ ] **Step 3: Apply and verify on a fresh DB**

Run: `./dev npm run db:reset`
Expected: no errors; migration applies. (This is the fresh-DB check that catches a missing grant.)

- [ ] **Step 4: Sanity-check the grant**

Run: `./dev bash -c "psql \"\$DATABASE_URL\" -c 'select count(*) from push_subscription;'"`
Expected: `0` (not a 42501 permission error). If `DATABASE_URL` isn't set in-container, skip — the `db:reset` success plus a later route test covers it.

- [ ] **Step 5: Commit & push**

```bash
git add supabase/migrations/20260906120000_push_notifications.sql
git commit -m "feat(push): schema for subscriptions, opt-in list, reminder marker"
git push
```

---

## Task 2: Notification type registry

**Files:**
- Create: `src/lib/notification-types.ts`
- Test: `src/lib/notification-types.test.ts`

**Interfaces:**
- Produces:
  - `type NotificationType = "admin_alerts" | "clocked_in_late" | "meeting_reminder" | "consent_missing" | "meeting_changed"`
  - `const NOTIFICATION_TYPES: readonly NotificationType[]`
  - `type NotificationMeta = { type: NotificationType; label: string; description: string; roles: Role[] }`
  - `const NOTIFICATION_META: Record<NotificationType, NotificationMeta>`
  - `function isNotificationType(v: unknown): v is NotificationType`
  - `function typesForRole(role: Role): NotificationMeta[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/notification-types.test.ts
import { describe, expect, test } from "vitest";
import {
  NOTIFICATION_TYPES,
  isNotificationType,
  typesForRole,
} from "./notification-types";

describe("notification-types", () => {
  test("registry lists all five types", () => {
    expect([...NOTIFICATION_TYPES].sort()).toEqual(
      ["admin_alerts", "clocked_in_late", "consent_missing", "meeting_changed", "meeting_reminder"],
    );
  });

  test("isNotificationType guards unknown strings", () => {
    expect(isNotificationType("admin_alerts")).toBe(true);
    expect(isNotificationType("nope")).toBe(false);
    expect(isNotificationType(42)).toBe(false);
  });

  test("students see meeting types but not admin_alerts or consent_missing", () => {
    const forStudent = typesForRole("student").map((m) => m.type).sort();
    expect(forStudent).toEqual(["clocked_in_late", "meeting_changed", "meeting_reminder"]);
  });

  test("guests get nothing", () => {
    expect(typesForRole("guest")).toHaveLength(0);
  });

  test("admins see every type", () => {
    expect(typesForRole("admin")).toHaveLength(5);
  });

  test("mentors see consent_missing but not admin_alerts", () => {
    const forMentor = typesForRole("mentor").map((m) => m.type);
    expect(forMentor).toContain("consent_missing");
    expect(forMentor).not.toContain("admin_alerts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev npm run test -- notification-types`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/notification-types.ts
import type { Role } from "./types";

export const NOTIFICATION_TYPES = [
  "admin_alerts",
  "clocked_in_late",
  "meeting_reminder",
  "consent_missing",
  "meeting_changed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationMeta = {
  type: NotificationType;
  label: string;
  description: string;
  roles: Role[]; // which roles may enable this type
};

// Role = "admin" | "mentor" | "student" | "guest". Members = everyone signed in
// except guests. (There is no app-level "captain" Role — that's a person_role
// enum value the app maps to "student"; do not reference it here.)
const MEMBER: Role[] = ["student", "mentor", "admin"];
const MENTORS: Role[] = ["mentor", "admin"];
const ADMINS: Role[] = ["admin"];

export const NOTIFICATION_META: Record<NotificationType, NotificationMeta> = {
  admin_alerts: {
    type: "admin_alerts",
    label: "Admin alerts",
    description: "Sync failures and other #hub-admin-alerts posts.",
    roles: ADMINS,
  },
  clocked_in_late: {
    type: "clocked_in_late",
    label: "Still clocked in",
    description: "A nightly nudge if you forgot to clock out.",
    roles: MEMBER,
  },
  meeting_reminder: {
    type: "meeting_reminder",
    label: "Meeting reminders",
    description: "A reminder a few hours before a meeting starts.",
    roles: MEMBER,
  },
  consent_missing: {
    type: "consent_missing",
    label: "Outstanding FIRST requirements",
    description: "A weekly reminder if you have unfinished consent/YPP items.",
    roles: MENTORS,
  },
  meeting_changed: {
    type: "meeting_changed",
    label: "Meeting time changes",
    description: "When a meeting's start time moves.",
    roles: MEMBER,
  },
};

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(v);
}

export function typesForRole(role: Role): NotificationMeta[] {
  return NOTIFICATION_TYPES.map((t) => NOTIFICATION_META[t]).filter((m) => m.roles.includes(role));
}
```

Confirmed: `Role = "admin" | "mentor" | "student" | "guest"` in `src/lib/types.ts` — no `captain`. `MEMBER` above is correct as written.

- [ ] **Step 4: Run test to verify it passes**

Run: `./dev npm run test -- notification-types`
Expected: PASS.

- [ ] **Step 5: Commit & push**

```bash
git add src/lib/notification-types.ts src/lib/notification-types.test.ts
git commit -m "feat(push): notification type registry with per-role availability"
git push
```

---

## Task 3: Shared dispatcher core

**Files:**
- Modify: `package.json` (add `web-push` + `@types/web-push`)
- Create: `src/lib/push-dispatch.ts`
- Test: `src/lib/push-dispatch.test.ts`

**Interfaces:**
- Consumes: `NotificationType` (Task 2), `getDb`, `SupabaseClient`.
- Produces:
  - `type PushPayload = { title: string; body: string; url: string }`
  - `type PushDeps = { publicKey: string; privateKey: string; subject: string; send: SendFn } | null`
  - `function pushDepsFromEnv(): PushDeps`
  - `function sanitizePushText(s: string): string`
  - `async function sendPushToOptedIn(personIds: string[] | "all", type: NotificationType, payload: PushPayload, deps: { db: SupabaseClient; push?: PushDeps }): Promise<{ sent: number; pruned: number }>`

- [ ] **Step 1: Add the dependency**

Run: `./dev npm install web-push && ./dev npm install -D @types/web-push`
Expected: `web-push` in `dependencies`, `@types/web-push` in `devDependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/push-dispatch.test.ts
import { describe, expect, test, vi } from "vitest";
import { sanitizePushText, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

const PUSH: PushDeps = {
  publicKey: "pub",
  privateKey: "priv",
  subject: "mailto:dev@example.com",
  send: vi.fn(),
};

// Minimal fake query builder: db.from("push_subscription")...returns rows.
function fakeDb(rows: any[]) {
  const deleted: string[] = [];
  const db: any = {
    _deleted: deleted,
    from() {
      return {
        select: () => ({
          in: () => ({ data: rows, error: null }),
          // "all" path uses .not(...) or no filter; return same rows
          not: () => ({ data: rows, error: null }),
        }),
        delete: () => ({
          eq: (_c: string, id: string) => {
            deleted.push(id);
            return { error: null };
          },
        }),
      };
    },
  };
  return db;
}

describe("sanitizePushText", () => {
  test("strips emoji shortcodes and fenced code blocks", () => {
    expect(sanitizePushText(":rotating_light: FIRST sync is failing.\n```err```"))
      .toBe("FIRST sync is failing.");
  });
});

describe("sendPushToOptedIn", () => {
  test("no-ops (logged) when push is unconfigured", async () => {
    const db = fakeDb([]);
    const res = await sendPushToOptedIn(["p1"], "admin_alerts", { title: "t", body: "b", url: "/" }, { db, push: null });
    expect(res).toEqual({ sent: 0, pruned: 0 });
  });

  test("sends to each subscription and reports count", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const db = fakeDb([
      { id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1" },
      { id: "s2", endpoint: "https://push/2", p256dh: "k2", auth: "a2" },
    ]);
    const res = await sendPushToOptedIn(["p1"], "admin_alerts", { title: "t", body: "b", url: "/x" }, { db, push: { ...PUSH, send } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(res.sent).toBe(2);
  });

  test("prunes a subscription on 404/410", async () => {
    const send = vi.fn().mockRejectedValue({ statusCode: 410 });
    const db = fakeDb([{ id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1" }]);
    const res = await sendPushToOptedIn(["p1"], "admin_alerts", { title: "t", body: "b", url: "/" }, { db, push: { ...PUSH, send } });
    expect(res.pruned).toBe(1);
    expect(db._deleted).toContain("s1");
  });

  test("a single send failure is swallowed, others proceed", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValueOnce(undefined);
    const db = fakeDb([
      { id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1" },
      { id: "s2", endpoint: "https://push/2", p256dh: "k2", auth: "a2" },
    ]);
    const res = await sendPushToOptedIn(["p1"], "admin_alerts", { title: "t", body: "b", url: "/" }, { db, push: { ...PUSH, send } });
    expect(res.sent).toBe(1); // s2 only
    expect(res.pruned).toBe(0); // 500 is not a prune
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./dev npm run test -- push-dispatch`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// src/lib/push-dispatch.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { NotificationType } from "./notification-types";

export type PushPayload = { title: string; body: string; url: string };

type SendFn = typeof webpush.sendNotification;

export type PushDeps = {
  publicKey: string;
  privateKey: string;
  subject: string;
  send: SendFn;
} | null;

/** null (⇒ dispatch becomes a logged no-op) when keys are unset. */
export function pushDepsFromEnv(): PushDeps {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject, send: webpush.sendNotification };
}

/** Slack alert text carries mrkdwn (":emoji:", ```fenced``` raw errors) that is
 *  wrong for a lock screen. Strip both to plain text. */
export function sanitizePushText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks (incl. raw error dumps)
    .replace(/:[a-z0-9_+-]+:/gi, "") // emoji shortcodes
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const SEND_TIMEOUT_MS = 8000;

function isGone(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode;
  return code === 404 || code === 410;
}

/** Send one payload to every subscription owned by an opted-in person.
 *  `personIds` may be "all" for team-wide types. Never throws. */
export async function sendPushToOptedIn(
  personIds: string[] | "all",
  type: NotificationType,
  payload: PushPayload,
  deps: { db: SupabaseClient; push?: PushDeps },
): Promise<{ sent: number; pruned: number }> {
  const push = deps.push;
  if (!push) {
    console.log(`[push:unconfigured] would send ${type} to ${personIds === "all" ? "all" : personIds.length} person(s)`);
    return { sent: 0, pruned: 0 };
  }

  // Join push_subscription → person, keep only active persons opted into `type`.
  // person_id filter is skipped for "all".
  let query = deps.db
    .from("push_subscription")
    .select("id, endpoint, p256dh, auth, person!inner(id, is_active, notification_types)");
  query = personIds === "all"
    ? query.not("person_id", "is", null)
    : query.in("person_id", personIds);
  const { data, error } = await query;
  if (error) {
    console.error(`[push] load subscriptions failed for ${type}:`, error.message);
    return { sent: 0, pruned: 0 };
  }

  type Row = {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    person: { is_active: boolean; notification_types: string[] } | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.person?.is_active && r.person.notification_types.includes(type),
  );

  webpush.setVapidDetails(push.subject, push.publicKey, push.privateKey);
  const body = JSON.stringify(payload);

  let sent = 0;
  let pruned = 0;
  await Promise.allSettled(
    rows.map(async (r) => {
      try {
        await push.send(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          body,
          { TTL: 3600, timeout: SEND_TIMEOUT_MS },
        );
        sent += 1;
      } catch (err) {
        if (isGone(err)) {
          pruned += 1;
          await deps.db.from("push_subscription").delete().eq("id", r.id);
        } else {
          console.error(`[push] send failed for ${r.id}:`, (err as Error)?.message ?? err);
        }
      }
    }),
  );
  return { sent, pruned };
}
```

Note: the test's fake `db` returns the same rows from both `.in()` and `.not()`, and its rows omit the `person` embed — so add `person: { is_active: true, notification_types: [type] }` to each fake row in Step 2, OR relax the filter in tests. **Adjust the Step 2 fake rows to include** `person: { is_active: true, notification_types: ["admin_alerts"] }` before running. (Do this so the tests exercise the real filter.)

- [ ] **Step 5: Run test to verify it passes**

Run: `./dev npm run test -- push-dispatch`
Expected: PASS.

- [ ] **Step 6: Typecheck & commit**

```bash
./dev npm run typecheck
git add package.json package-lock.json src/lib/push-dispatch.ts src/lib/push-dispatch.test.ts
git commit -m "feat(push): shared dispatcher core (send, prune, sanitize)"
git push
```

---

## Task 4: PWA plumbing (service worker + manifest)

**Files:**
- Create: `public/sw.js`
- Create: `src/app/manifest.ts`
- Modify: `src/app/layout.tsx` (add `appleWebApp` to metadata)

**Interfaces:**
- Produces: a service worker at `/sw.js` (scope `/`) handling `push` + `notificationclick`; a manifest at `/manifest.webmanifest`.

- [ ] **Step 1: Read the manifest doc**

Run: `sed -n '1,80p' node_modules/next/dist/docs/**/manifest.md` (find it first: `ls node_modules/next/dist/docs` then locate the metadata/manifest guide). Confirm the `MetadataRoute.Manifest` return shape and that `app/manifest.ts` auto-injects the `<link rel="manifest">`.

- [ ] **Step 2: Write the service worker**

```js
// public/sw.js — static; scope "/". No offline caching, push only.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "1741 Hub";
  const body = data.body || "";
  const url = data.url || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: "/icon.png",
      badge: "/icon.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
```

Note: `/icon.png` — confirm the app serves an icon at a stable path. `src/app/icon.png` is served by Next at `/icon.png`? App-Router icons are served at hashed metadata routes, not `/icon.png`. Safer: copy a 192×192 PNG to `public/icon-192.png` and reference `/icon-192.png`, OR omit `icon`/`badge` (the SW still works without them). **Pick: omit icon/badge if unsure**, or add `public/icon-192.png`. Verify whichever you choose renders.

- [ ] **Step 3: Write the manifest**

```ts
// src/app/manifest.ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "1741 Hub",
    short_name: "Hub",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff", // match the app's ground; check globals.css tokens
    theme_color: "#b91c1c",       // Red Alert red; confirm the exact brand token
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

Generate the two PNGs from the square 270×270 `src/app/icon.png` and place them in `public/`:

Run: `./dev bash -c "cd /app && npx --yes sharp-cli resize 192 192 -i src/app/icon.png -o public/icon-192.png && npx --yes sharp-cli resize 512 512 -i src/app/icon.png -o public/icon-512.png"`
(If `sharp-cli` isn't available, generate them however the repo already produces raster assets; the goal is two square PNGs in `public/`.)

- [ ] **Step 4: Add appleWebApp metadata**

In `src/app/layout.tsx`, in the exported `metadata` object, add:

```ts
  appleWebApp: {
    capable: true,
    title: "1741 Hub",
    statusBarStyle: "default",
  },
```

- [ ] **Step 5: Verify the manifest + SW are served**

Run: `docker compose up -d` (if not running), then in-container:
`./dev bash -c "curl -sf http://localhost:3000/manifest.webmanifest | head -c 200 && echo && curl -sfI http://localhost:3000/sw.js | head -1"`
Expected: manifest JSON prints; `/sw.js` returns `200`.

- [ ] **Step 6: Commit & push**

```bash
git add public/sw.js public/icon-192.png public/icon-512.png src/app/manifest.ts src/app/layout.tsx
git commit -m "feat(push): PWA plumbing — service worker + manifest + appleWebApp"
git push
```

---

## Task 5: Subscription + prefs API routes

**Files:**
- Create: `src/app/api/push/subscribe/route.ts`
- Create: `src/app/api/push/unsubscribe/route.ts`
- Create: `src/app/api/notifications/prefs/route.ts`
- Test: `src/app/api/push/subscribe/route.test.ts`, `src/app/api/notifications/prefs/route.test.ts`

**Interfaces:**
- Consumes: `withRole` (`src/lib/api.ts`), `getDb`, `isNotificationType` + `NOTIFICATION_META` (Task 2), `Viewer`.
- Produces: `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `PATCH /api/notifications/prefs`.

- [ ] **Step 1: Write the failing test (subscribe)**

```ts
// src/app/api/push/subscribe/route.test.ts
import { describe, expect, test, vi } from "vitest";

// Build a request + fake viewer, call the exported handler via withRole's
// viewerSource injection. Because the route wires withRole at module scope,
// test the inner logic by importing the handler it wraps. Export the inner
// handler from the route for testability (see implementation).
import { subscribeHandler } from "./route";

function req(body: unknown, method = "POST") {
  return new Request("http://localhost/api/push/subscribe", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const viewer: any = { role: "student", person: { id: "p1" }, masquerade: undefined };

test("rejects a non-https endpoint", async () => {
  const db: any = { from: vi.fn() };
  const res = await subscribeHandler(viewer, req({ endpoint: "http://push/1", keys: { p256dh: "k", auth: "a" } }), undefined, db);
  expect(res.status).toBe(400);
  expect(db.from).not.toHaveBeenCalled();
});

test("upserts a valid subscription for the viewer", async () => {
  const upsert = vi.fn().mockReturnValue({ error: null });
  const db: any = { from: () => ({ upsert }) };
  const res = await subscribeHandler(
    viewer,
    req({ endpoint: "https://push/1", keys: { p256dh: "k", auth: "a" } }),
    undefined,
    db,
  );
  expect(res.status).toBe(200);
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({ person_id: "p1", endpoint: "https://push/1", p256dh: "k", auth: "a" }),
    { onConflict: "endpoint" },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npm run test -- api/push/subscribe`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement subscribe**

```ts
// src/app/api/push/subscribe/route.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import type { Viewer } from "@/lib/viewer";

// Inner handler exported for unit tests; db injectable.
export async function subscribeHandler(
  viewer: Viewer,
  request: Request,
  _ctx: unknown,
  db: SupabaseClient = getDb(),
): Promise<Response> {
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !endpoint.startsWith("https://") || !p256dh || !auth) {
    return Response.json({ error: "invalid_subscription" }, { status: 400 });
  }
  const { error } = await db.from("push_subscription").upsert(
    {
      person_id: viewer.person.id,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get("user-agent"),
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return Response.json({ error: "store_failed" }, { status: 500 });
  return Response.json({ ok: true });
}

export const POST = withRole("student", (viewer, request, ctx) => subscribeHandler(viewer, request, ctx));
```

- [ ] **Step 4: Implement unsubscribe**

```ts
// src/app/api/push/unsubscribe/route.ts
import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";

export const POST = withRole("student", async (viewer, request) => {
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) return Response.json({ error: "missing_endpoint" }, { status: 400 });
  // Delete only the viewer's own row for this endpoint.
  await getDb()
    .from("push_subscription")
    .delete()
    .eq("person_id", viewer.person.id)
    .eq("endpoint", body.endpoint);
  return Response.json({ ok: true });
});
```

- [ ] **Step 5: Write the failing test (prefs)**

```ts
// src/app/api/notifications/prefs/route.test.ts
import { describe, expect, test, vi } from "vitest";
import { prefsHandler } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/notifications/prefs", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const student: any = { role: "student", person: { id: "p1", notification_types: [] } };
const admin: any = { role: "admin", person: { id: "a1", notification_types: [] } };

test("rejects an unknown type", async () => {
  const db: any = { from: vi.fn() };
  const res = await prefsHandler(student, req({ type: "bogus", enabled: true }), undefined, db);
  expect(res.status).toBe(400);
});

test("a student cannot enable admin_alerts", async () => {
  const db: any = { from: vi.fn() };
  const res = await prefsHandler(student, req({ type: "admin_alerts", enabled: true }), undefined, db);
  expect(res.status).toBe(403);
  expect(db.from).not.toHaveBeenCalled();
});

test("enabling adds the type via array_append RPC/update", async () => {
  const update = vi.fn().mockReturnValue({ eq: () => ({ error: null }) });
  const db: any = { from: () => ({ update }) };
  const res = await prefsHandler(admin, req({ type: "admin_alerts", enabled: true }), undefined, db);
  expect(res.status).toBe(200);
});
```

- [ ] **Step 6: Implement prefs**

```ts
// src/app/api/notifications/prefs/route.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import { NOTIFICATION_META, isNotificationType } from "@/lib/notification-types";
import type { Viewer } from "@/lib/viewer";

export async function prefsHandler(
  viewer: Viewer,
  request: Request,
  _ctx: unknown,
  db: SupabaseClient = getDb(),
): Promise<Response> {
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { type?: unknown; enabled?: unknown } | null;
  const type = body?.type;
  const enabled = body?.enabled === true;
  if (!isNotificationType(type)) return Response.json({ error: "unknown_type" }, { status: 400 });
  if (!NOTIFICATION_META[type].roles.includes(viewer.role)) {
    return Response.json({ error: "forbidden_type" }, { status: 403 });
  }
  // Recompute the array from the viewer's current set (source of truth = DB row,
  // but viewer.person carries it; re-read to avoid a lost update is overkill for
  // a single-user toggle). Read current, add/remove, write.
  const current = new Set((viewer.person as { notification_types?: string[] }).notification_types ?? []);
  if (enabled) current.add(type);
  else current.delete(type);
  const { error } = await db
    .from("person")
    .update({ notification_types: [...current] })
    .eq("id", viewer.person.id);
  if (error) return Response.json({ error: "store_failed" }, { status: 500 });
  return Response.json({ ok: true, notification_types: [...current] });
}

export const PATCH = withRole("student", (viewer, request, ctx) => prefsHandler(viewer, request, ctx));
```

Note: confirm `personFromRow`/`Person` carries `notification_types`. Check `src/lib/types.ts` `personFromRow` and add the field to the row select + type so `viewer.person.notification_types` is populated. If `getViewer` selects specific columns, add `notification_types` there too (`grep "notification_types\|is_active\|select(" src/lib/viewer.ts`).

- [ ] **Step 7: Run both route tests**

Run: `./dev npm run test -- "api/push/subscribe" "api/notifications/prefs"`
Expected: PASS.

- [ ] **Step 8: Confirm the allowlist test still passes (these use withRole, so no entry needed)**

Run: `./dev npm run test -- route-auth-allowlist`
Expected: PASS.

- [ ] **Step 9: Commit & push**

```bash
git add src/app/api/push src/app/api/notifications
git commit -m "feat(push): subscribe/unsubscribe/prefs routes (withRole-gated)"
git push
```

---

## Task 6: Settings UI + home card

**Files:**
- Create: `src/app/me/notifications/page.tsx` (server)
- Create: `src/app/me/notifications/NotificationSettings.tsx` (client)
- Create/Modify: the home dashboard page — mount a dismissible `EnablePushCard.tsx`
- Create: `e2e/notifications.spec.ts`

**Interfaces:**
- Consumes: `getViewer`, `typesForRole` (Task 2), `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the three routes (Task 5).

- [ ] **Step 1: Server page**

```tsx
// src/app/me/notifications/page.tsx
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { typesForRole } from "@/lib/notification-types";
import { NotificationSettings } from "./NotificationSettings";

export default async function NotificationsPage() {
  const viewer = await getViewer();
  if (!viewer.person) redirect("/login");
  const configured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const enabled = new Set((viewer.person as { notification_types?: string[] }).notification_types ?? []);
  const types = typesForRole(viewer.role).map((m) => ({ ...m, enabled: enabled.has(m.type) }));
  return (
    <main>
      <h1>Notifications</h1>
      {!configured && <p>Push is not configured on this server.</p>}
      <NotificationSettings
        configured={configured}
        publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        types={types}
      />
    </main>
  );
}
```

- [ ] **Step 2: Client component (subscribe flow + toggles)**

```tsx
// src/app/me/notifications/NotificationSettings.tsx
"use client";
import { useState } from "react";

type TypeRow = { type: string; label: string; description: string; enabled: boolean };

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function NotificationSettings({
  configured,
  publicKey,
  types,
}: {
  configured: boolean;
  publicKey: string;
  types: TypeRow[];
}) {
  const [rows, setRows] = useState(types);
  const [deviceOn, setDeviceOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function enableDevice() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setMsg("This browser doesn't support push. On iOS, add the app to your home screen first.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMsg("Notification permission denied.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setDeviceOn(res.ok);
      setMsg(res.ok ? "This device is enabled." : "Failed to register this device.");
    } catch (e) {
      setMsg("Could not enable push on this device.");
    }
  }

  async function toggle(type: string, enabled: boolean) {
    setRows((rs) => rs.map((r) => (r.type === type ? { ...r, enabled } : r)));
    const res = await fetch("/api/notifications/prefs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, enabled }),
    });
    if (!res.ok) {
      // revert on failure
      setRows((rs) => rs.map((r) => (r.type === type ? { ...r, enabled: !enabled } : r)));
    }
  }

  return (
    <div>
      <button type="button" onClick={enableDevice} disabled={!configured}>
        {deviceOn ? "Device enabled" : "Enable on this device"}
      </button>
      {msg && <p>{msg}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.type}>
            <label>
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => toggle(r.type, e.target.checked)}
                data-testid={`toggle-${r.type}`}
              />
              {r.label} — {r.description}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Note: match the repo's existing form/button styling and components (look at another `/me/*` page). Follow existing patterns rather than raw elements if the codebase has UI primitives.

- [ ] **Step 3: Home dashboard card (dismissible)**

Find the home dashboard page (`grep -rl "WhosHere\|dashboard" src/app/(*)/page.tsx` or check `src/app/page.tsx`). Add a client card shown to a signed-in member who hasn't dismissed it (`localStorage` key `hub_push_card_dismissed`). Card links to `/me/notifications` and has a "Dismiss" button. Guests never see it (only render when viewer is a member — gate server-side by passing a prop).

```tsx
// src/app/(...)/EnablePushCard.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export function EnablePushCard() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem("hub_push_card_dismissed") !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  return (
    <aside>
      <p>Turn on notifications to get reminders on your devices.</p>
      <Link href="/me/notifications">Set up notifications</Link>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem("hub_push_card_dismissed", "1");
          } catch {}
          setShow(false);
        }}
      >
        Dismiss
      </button>
    </aside>
  );
}
```

Mount it on the home page only for signed-in members (`{viewer.person && <EnablePushCard />}`).

- [ ] **Step 4: E2E**

```ts
// e2e/notifications.spec.ts
import { test, expect } from "@playwright/test";

test("guest is redirected from /me/notifications", async ({ page }) => {
  await page.goto("/me/notifications");
  await expect(page).toHaveURL(/\/login/);
});

test("a signed-in student sees meeting toggles and one persists", async ({ page }) => {
  // Use the dev-login button (non-prod) to sign in as a student.
  await page.goto("/login");
  await page.getByRole("button", { name: /log in as student/i }).click();
  await page.goto("/me/notifications");
  const toggle = page.getByTestId("toggle-meeting_reminder");
  await expect(toggle).toBeVisible();
  await toggle.check();
  await page.reload();
  await expect(page.getByTestId("toggle-meeting_reminder")).toBeChecked();
  // admin_alerts must NOT be offered to a student
  await expect(page.getByTestId("toggle-admin_alerts")).toHaveCount(0);
});
```

- [ ] **Step 5: Run e2e (stack must be up)**

Run: `docker compose up -d && ./dev npm run e2e -- notifications`
Expected: PASS. (First route hit compiles slowly; if it times out cold, re-run — see the cold-dev-server note.)

- [ ] **Step 6: Manual browser check**

Verify at `http://localhost:$APP_PORT/me/notifications`: the enable button, the toggles for the role, and (if `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set in `.env`) that "Enable on this device" registers the SW without a console error.

- [ ] **Step 7: Commit & push**

```bash
git add src/app/me/notifications e2e/notifications.spec.ts src/app/**/EnablePushCard.tsx
git commit -m "feat(push): /me/notifications settings + dismissible home card"
git push
```

---

## Task 7: `admin_alerts` trigger

**Files:**
- Create: `src/lib/admin-notify.ts`
- Test: `src/lib/admin-notify.test.ts`
- Modify: `src/lib/slack-alerts.ts`, `src/lib/mentor-reminders.ts`

**Interfaces:**
- Consumes: `postChannelMessage` + `SlackDeps` (`src/lib/slack.ts`), `sendPushToOptedIn` + `pushDepsFromEnv` + `sanitizePushText` (Task 3), `getDb`.
- Produces: `async function notifyAdmins(text: string, deps: { db: SupabaseClient; slack: SlackDeps; push?: PushDeps }): Promise<boolean>` — posts to `#hub-admin-alerts`, fans out `admin_alerts` push to opted-in admins, **returns Slack's boolean unchanged.**

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/admin-notify.test.ts
import { describe, expect, test, vi } from "vitest";
import { notifyAdmins } from "./admin-notify";

vi.mock("./slack", async (orig) => {
  const actual = await orig<typeof import("./slack")>();
  return { ...actual, postChannelMessage: vi.fn() };
});
vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 0, pruned: 0 }),
}));

import { postChannelMessage } from "./slack";
import { sendPushToOptedIn } from "./push-dispatch";

function adminIdsDb(ids: string[]) {
  return { from: () => ({ select: () => ({ eq: () => ({ data: ids.map((id) => ({ id })), error: null }) }) }) } as any;
}

test("returns Slack's delivered boolean unchanged (true)", async () => {
  (postChannelMessage as any).mockResolvedValue(true);
  const res = await notifyAdmins("hi", { db: adminIdsDb(["a1"]), slack: {} as any });
  expect(res).toBe(true);
});

test("returns false when Slack post failed, even if push succeeds", async () => {
  (postChannelMessage as any).mockResolvedValue(false);
  (sendPushToOptedIn as any).mockResolvedValue({ sent: 3, pruned: 0 });
  const res = await notifyAdmins("hi", { db: adminIdsDb(["a1"]), slack: {} as any });
  expect(res).toBe(false);
});

test("a throwing push fan-out does not change the return value", async () => {
  (postChannelMessage as any).mockResolvedValue(true);
  (sendPushToOptedIn as any).mockRejectedValue(new Error("boom"));
  const res = await notifyAdmins("hi", { db: adminIdsDb(["a1"]), slack: {} as any });
  expect(res).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npm run test -- admin-notify`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/admin-notify.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { postChannelMessage, type SlackDeps } from "./slack";
import { pushDepsFromEnv, sanitizePushText, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

/** Post to #hub-admin-alerts AND push admin_alerts to opted-in admins.
 *  Returns Slack's delivered boolean UNCHANGED — reportSyncOutcome advances its
 *  state machine on it, so push outcome must never leak in. Push is awaited but
 *  can neither throw nor change the return value. */
export async function notifyAdmins(
  text: string,
  deps: { db: SupabaseClient; slack: SlackDeps; push?: PushDeps },
): Promise<boolean> {
  const delivered = await postChannelMessage(deps.slack, "hub-admin-alerts", text);
  try {
    const { data } = await deps.db.from("person").select("id").eq("role", "admin");
    const adminIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (adminIds.length > 0) {
      const push = deps.push ?? pushDepsFromEnv();
      await sendPushToOptedIn(
        adminIds,
        "admin_alerts",
        { title: "Admin alert", body: sanitizePushText(text), url: "/admin" },
        { db: deps.db, push },
      );
    }
  } catch (e) {
    console.error("[admin-notify] push fan-out failed (Slack unaffected):", e);
  }
  return delivered;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./dev npm run test -- admin-notify`
Expected: PASS.

- [ ] **Step 5: Wire into slack-alerts.ts**

In `src/lib/slack-alerts.ts`, replace the `postChannelMessage(slack, "hub-admin-alerts", text)` call with `notifyAdmins(text, { db: opts.db, slack, push: opts.push })`. Add `push?: PushDeps` to `reportSyncOutcome`'s `opts`. The returned boolean already feeds `delivered` — behavior is identical, plus push.

Then run the existing slack-alerts tests: `./dev npm run test -- slack-alerts`
Expected: PASS (the state-machine tests still pass because the boolean is unchanged). Fix any mock that now needs `notifyAdmins`.

- [ ] **Step 6: Wire into mentor-reminders.ts (summary post only)**

In `src/lib/mentor-reminders.ts`, replace the summary `postChannelMessage(deps.slack, "hub-admin-alerts", summary)` with `notifyAdmins(summary, { db: deps.db, slack: deps.slack })`. Run: `./dev npm run test -- mentor-reminders`
Expected: PASS (fix mocks as needed).

- [ ] **Step 7: Commit & push**

```bash
git add src/lib/admin-notify.ts src/lib/admin-notify.test.ts src/lib/slack-alerts.ts src/lib/mentor-reminders.ts
git commit -m "feat(push): admin_alerts — mirror #hub-admin-alerts posts to opted-in admins"
git push
```

---

## Task 8: `consent_missing` trigger

**Files:**
- Modify: `src/lib/mentor-reminders.ts`
- Test: extend `src/lib/mentor-reminders.test.ts`

**Interfaces:**
- Consumes: `sendPushToOptedIn` + `pushDepsFromEnv` (Task 3), the existing `outstandingItems(m)` computation.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/mentor-reminders.test.ts` a test that, given a mentor with outstanding items, `sendPushToOptedIn` is called with `[m.personId]` and `"consent_missing"`. Mock `push-dispatch`:

```ts
import { sendPushToOptedIn } from "./push-dispatch";
vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 0, pruned: 0 }),
}));

test("pushes consent_missing to a mentor with outstanding items", async () => {
  // ...arrange a mentor row whose outstandingItems(m) is non-empty (e.g.
  // first_consent_release not 'green'), stub slack sendDM/postChannelMessage...
  await sendMentorReminders({ db, slack });
  expect(sendPushToOptedIn).toHaveBeenCalledWith(
    [expect.any(String)],
    "consent_missing",
    expect.objectContaining({ url: "/admin/first-status" }),
    expect.objectContaining({ db }),
  );
});
```

Match the existing test's arrangement style for building mentor rows.

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npm run test -- mentor-reminders`
Expected: FAIL (no push call yet).

- [ ] **Step 3: Implement**

In the per-mentor loop in `sendMentorReminders`, where `outstandingItems(m)` is already computed and non-empty (the same branch that DMs), add after the DM:

```ts
      await sendPushToOptedIn(
        [m.personId],
        "consent_missing",
        {
          title: "Outstanding FIRST requirements",
          body: "You still have unfinished consent/YPP items.",
          url: "/admin/first-status",
        },
        { db: deps.db, push: pushDepsFromEnv() },
      );
```

Add the imports at the top. Push is independent of the Slack DM result.

- [ ] **Step 4: Run to verify it passes**

Run: `./dev npm run test -- mentor-reminders`
Expected: PASS.

- [ ] **Step 5: Commit & push**

```bash
git add src/lib/mentor-reminders.ts src/lib/mentor-reminders.test.ts
git commit -m "feat(push): consent_missing — push mentors with outstanding FIRST items"
git push
```

---

## Task 9: `clocked_in_late` cron

**Files:**
- Create: `src/app/api/cron/push/clocked-in-late/route.ts`
- Create: `src/lib/clocked-in-late.ts` (recipient computation, testable)
- Create: `supabase/migrations/20260906120100_push_clocked_in_late_cron.sql`
- Modify: `src/app/route-auth-allowlist.test.ts`
- Test: `src/lib/clocked-in-late.test.ts`

**Interfaces:**
- Consumes: `getDb`, `getSetting`, `secureEqual`, `sendPushToOptedIn` + `pushDepsFromEnv`.
- Produces: `POST /api/cron/push/clocked-in-late`; `async function pushClockedInLate(deps: { db; push? }): Promise<{ sent: number; pruned: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/clocked-in-late.test.ts
import { describe, expect, test, vi } from "vitest";
import { pushClockedInLate } from "./clocked-in-late";

vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 2, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";

test("targets persons with an open session (time_out is null)", async () => {
  const db: any = {
    from: () => ({
      select: () => ({ is: () => ({ data: [{ person_id: "p1" }, { person_id: "p2" }, { person_id: "p1" }], error: null }) }),
    }),
  };
  await pushClockedInLate({ db });
  expect(sendPushToOptedIn).toHaveBeenCalledWith(
    expect.arrayContaining(["p1", "p2"]),
    "clocked_in_late",
    expect.objectContaining({ url: "/me/attendance" }),
    expect.objectContaining({ db }),
  );
  // dedupes p1
  const ids = (sendPushToOptedIn as any).mock.calls[0][0];
  expect(new Set(ids).size).toBe(ids.length);
});

test("no open sessions → no send", async () => {
  (sendPushToOptedIn as any).mockClear();
  const db: any = { from: () => ({ select: () => ({ is: () => ({ data: [], error: null }) }) }) };
  const res = await pushClockedInLate({ db });
  expect(sendPushToOptedIn).not.toHaveBeenCalled();
  expect(res).toEqual({ sent: 0, pruned: 0 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npm run test -- clocked-in-late`
Expected: FAIL.

- [ ] **Step 3: Implement the lib**

```ts
// src/lib/clocked-in-late.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

export async function pushClockedInLate(deps: {
  db: SupabaseClient;
  push?: PushDeps;
}): Promise<{ sent: number; pruned: number }> {
  const { data, error } = await deps.db.from("session").select("person_id").is("time_out", null);
  if (error) {
    console.error("[clocked-in-late] load open sessions failed:", error.message);
    return { sent: 0, pruned: 0 };
  }
  const ids = [...new Set(((data ?? []) as { person_id: string }[]).map((r) => r.person_id))];
  if (ids.length === 0) return { sent: 0, pruned: 0 };
  return sendPushToOptedIn(
    ids,
    "clocked_in_late",
    { title: "Still clocked in", body: "Forget to clock out?", url: "/me/attendance" },
    { db: deps.db, push: deps.push ?? pushDepsFromEnv() },
  );
}
```

- [ ] **Step 4: Implement the route (copy the mentor-reminders cron shape)**

```ts
// src/app/api/cron/push/clocked-in-late/route.ts
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { pushClockedInLate } from "@/lib/clocked-in-late";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("push_cron_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await pushClockedInLate({ db });
    return Response.json(result);
  } catch (e) {
    console.error("clocked-in-late push failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Add the allowlist entry**

In `src/app/route-auth-allowlist.test.ts`, under "Shared-secret gates", add:

```ts
  "api/cron/push/clocked-in-late/route.ts":
    "x-sync-secret compared in constant time (secureEqual); fails closed when unset.",
```

- [ ] **Step 6: Write the pg_cron migration**

```sql
-- 20260906120100_push_clocked_in_late_cron.sql
-- Nightly "still clocked in" nudge. Fixed UTC hour (pg_cron runs in UTC and
-- can't read the team timezone). 03:00 UTC ≈ 10pm EST / 11pm EDT — an evening
-- hour, and BEFORE the 08:00 UTC close-stale-sessions sweep so there are still
-- open sessions to nudge. Adjust via the /admin/cron editor if the team moves.
-- URL + shared secret read from app_setting at run time (set per-env in prod).
insert into app_setting (key, value) values
  ('push_clocked_in_late_url', '"http://host.docker.internal:3000/api/cron/push/clocked-in-late"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'push-clocked-in-late',
  '0 3 * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'push_clocked_in_late_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'push_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

- [ ] **Step 7: Run tests + fresh-DB apply**

Run: `./dev npm run test -- clocked-in-late route-auth-allowlist && ./dev npm run db:reset`
Expected: PASS; migration applies clean.

- [ ] **Step 8: Commit & push**

```bash
git add src/lib/clocked-in-late.ts src/lib/clocked-in-late.test.ts src/app/api/cron/push/clocked-in-late supabase/migrations/20260906120100_push_clocked_in_late_cron.sql src/app/route-auth-allowlist.test.ts
git commit -m "feat(push): clocked_in_late nightly cron"
git push
```

---

## Task 10: `meeting_reminder` cron

**Files:**
- Create: `src/app/api/cron/push/meeting-reminder/route.ts`
- Create: `src/lib/meeting-reminder.ts`
- Create: `supabase/migrations/20260906120200_push_meeting_reminder_cron.sql`
- Modify: `src/app/route-auth-allowlist.test.ts`
- Test: `src/lib/meeting-reminder.test.ts`

**Interfaces:**
- Consumes: `getDb`, `getSetting`, `secureEqual`, `sendPushToOptedIn` + `pushDepsFromEnv`.
- Produces: `POST /api/cron/push/meeting-reminder`; `async function pushMeetingReminders(deps: { db; push?; nowIso: string }): Promise<{ sent: number; pruned: number; meetings: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/meeting-reminder.test.ts
import { describe, expect, test, vi } from "vitest";
import { pushMeetingReminders } from "./meeting-reminder";

vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 5, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";

// db.from("meeting").select(...).gte(...).lte(...).is(...) → rows; then update stamp
function fakeDb(rows: any[]) {
  const stamped: string[] = [];
  const db: any = {
    _stamped: stamped,
    from: () => ({
      select: () => ({
        gte: () => ({ lte: () => ({ is: () => ({ data: rows, error: null }) }) }),
      }),
      update: () => ({ eq: (_c: string, id: string) => { stamped.push(id); return { error: null }; } }),
    }),
  };
  return db;
}

test("reminds meetings in the next 3h once, stamps them, targets all", async () => {
  const db = fakeDb([{ id: "m1", title: "Build", starts_at: "2026-09-06T22:00:00Z" }]);
  const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T20:00:00Z" });
  expect(sendPushToOptedIn).toHaveBeenCalledWith("all", "meeting_reminder", expect.objectContaining({ url: "/calendar" }), expect.objectContaining({ db }));
  expect(db._stamped).toContain("m1");
});

test("no upcoming meetings → no send", async () => {
  (sendPushToOptedIn as any).mockClear();
  const db = fakeDb([]);
  const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T20:00:00Z" });
  expect(sendPushToOptedIn).not.toHaveBeenCalled();
  expect(res.meetings).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npm run test -- meeting-reminder`
Expected: FAIL.

- [ ] **Step 3: Implement the lib**

```ts
// src/lib/meeting-reminder.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

const LEAD_MS = 3 * 60 * 60 * 1000; // 3 hours

export async function pushMeetingReminders(deps: {
  db: SupabaseClient;
  push?: PushDeps;
  nowIso: string;
}): Promise<{ sent: number; pruned: number; meetings: number }> {
  const now = new Date(deps.nowIso);
  const until = new Date(now.getTime() + LEAD_MS).toISOString();
  const { data, error } = await deps.db
    .from("meeting")
    .select("id, title, starts_at")
    .gte("starts_at", deps.nowIso)
    .lte("starts_at", until)
    .is("reminder_pushed_at", null);
  if (error) {
    console.error("[meeting-reminder] load meetings failed:", error.message);
    return { sent: 0, pruned: 0, meetings: 0 };
  }
  const meetings = (data ?? []) as { id: string; title: string; starts_at: string }[];
  if (meetings.length === 0) return { sent: 0, pruned: 0, meetings: 0 };

  const push = deps.push ?? pushDepsFromEnv();
  let sent = 0;
  let pruned = 0;
  for (const m of meetings) {
    const when = new Date(m.starts_at).toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis", hour: "numeric", minute: "2-digit" });
    const res = await sendPushToOptedIn(
      "all",
      "meeting_reminder",
      { title: `Meeting at ${when}`, body: m.title || "Team meeting", url: "/calendar" },
      { db: deps.db, push },
    );
    sent += res.sent;
    pruned += res.pruned;
    await deps.db.from("meeting").update({ reminder_pushed_at: deps.nowIso }).eq("id", m.id);
  }
  return { sent, pruned, meetings: meetings.length };
}
```

- [ ] **Step 4: Implement the route**

```ts
// src/app/api/cron/push/meeting-reminder/route.ts
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { pushMeetingReminders } from "@/lib/meeting-reminder";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("push_cron_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await pushMeetingReminders({ db, nowIso: new Date().toISOString() });
    return Response.json(result);
  } catch (e) {
    console.error("meeting-reminder push failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Add the allowlist entry**

```ts
  "api/cron/push/meeting-reminder/route.ts":
    "x-sync-secret compared in constant time (secureEqual); fails closed when unset.",
```

- [ ] **Step 6: Write the pg_cron migration (hourly)**

```sql
-- 20260906120200_push_meeting_reminder_cron.sql
-- Hourly meeting-reminder sweep: the route reminds meetings starting within 3h
-- that haven't been reminded, and stamps reminder_pushed_at so each fires once.
insert into app_setting (key, value) values
  ('push_meeting_reminder_url', '"http://host.docker.internal:3000/api/cron/push/meeting-reminder"')
on conflict (key) do nothing;

create extension if not exists pg_net;

select cron.schedule(
  'push-meeting-reminder',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := (select value #>> '{}' from public.app_setting where key = 'push_meeting_reminder_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value #>> '{}' from public.app_setting where key = 'push_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

- [ ] **Step 7: Run tests + fresh-DB apply**

Run: `./dev npm run test -- meeting-reminder route-auth-allowlist && ./dev npm run db:reset`
Expected: PASS; migration applies.

- [ ] **Step 8: Commit & push**

```bash
git add src/lib/meeting-reminder.ts src/lib/meeting-reminder.test.ts src/app/api/cron/push/meeting-reminder supabase/migrations/20260906120200_push_meeting_reminder_cron.sql src/app/route-auth-allowlist.test.ts
git commit -m "feat(push): meeting_reminder hourly cron (3h lead, dedupe stamp)"
git push
```

---

## Task 11: `meeting_changed` trigger

**Files:**
- Modify: `src/lib/meetings.ts` (`updateMeeting`)
- Modify: `src/lib/gcal.ts` (meeting upsert path)
- Test: extend `src/lib/meetings.test.ts` and `src/lib/gcal.test.ts` (or create)

**Interfaces:**
- Consumes: `sendPushToOptedIn` + `pushDepsFromEnv`.
- Produces: a shared helper `async function notifyMeetingChanged(db, meeting: { id; title; starts_at }, push?): Promise<void>` in `src/lib/meetings.ts` that pushes AND resets `reminder_pushed_at = null`.

- [ ] **Step 1: Write the shared helper + its test**

```ts
// in src/lib/meetings.test.ts
import { vi } from "vitest";
vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 0, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";
import { notifyMeetingChanged } from "./meetings";

test("notifyMeetingChanged pushes meeting_changed to all and resets the reminder stamp", async () => {
  const update = vi.fn().mockReturnValue({ eq: () => ({ error: null }) });
  const db: any = { from: () => ({ update }) };
  await notifyMeetingChanged(db, { id: "m1", title: "Build", starts_at: "2026-09-07T22:00:00Z" });
  expect(sendPushToOptedIn).toHaveBeenCalledWith("all", "meeting_changed", expect.objectContaining({ url: "/calendar" }), expect.objectContaining({ db }));
  expect(update).toHaveBeenCalledWith({ reminder_pushed_at: null });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./dev npm run test -- meetings`
Expected: FAIL (no `notifyMeetingChanged` export).

- [ ] **Step 3: Implement the helper in meetings.ts**

```ts
import { pushDepsFromEnv, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

export async function notifyMeetingChanged(
  db: SupabaseClient,
  meeting: { id: string; title: string; starts_at: string },
  push?: PushDeps,
): Promise<void> {
  const when = new Date(meeting.starts_at).toLocaleString("en-US", {
    timeZone: "America/Indiana/Indianapolis",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  await sendPushToOptedIn(
    "all",
    "meeting_changed",
    { title: "Meeting time changed", body: `${meeting.title || "A meeting"} is now ${when}`, url: "/calendar" },
    { db, push: push ?? pushDepsFromEnv() },
  );
  // Reset so the moved meeting re-reminds at its new time.
  await db.from("meeting").update({ reminder_pushed_at: null }).eq("id", meeting.id);
}
```

- [ ] **Step 4: Fire it from `updateMeeting` (future-only, only if starts_at moved)**

Rework `updateMeeting` to read the prior `starts_at` before the update, and fire after a successful update when it moved and the new time is in the future:

```ts
export async function updateMeeting(id: string, input: ManualMeetingInput, db?: SupabaseClient) {
  const client = db ?? (await import("./db")).getDb();
  const { data: prior } = await client.from("meeting").select("starts_at").eq("id", id).maybeSingle();
  const { data, error } = await client
    .from("meeting")
    .update({ title: input.title, starts_at: input.startsAt, ends_at: input.endsAt })
    .eq("id", id)
    .select("id, title, starts_at")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  const moved = prior != null && (prior as { starts_at: string }).starts_at !== input.startsAt;
  const future = new Date(input.startsAt).getTime() > Date.now();
  if (moved && future) {
    try {
      await notifyMeetingChanged(client, data as { id: string; title: string; starts_at: string });
    } catch (e) {
      console.error("[meetings] meeting_changed push failed:", e);
    }
  }
  return { ok: true, status: 200 };
}
```

Add a test for `updateMeeting` asserting `notifyMeetingChanged` fires only when the time moved to a future time, not on an unchanged time.

- [ ] **Step 5: Fire it from the gcal upsert (`src/lib/gcal.ts`)**

The meeting upsert (`.from("meeting").upsert(meetingRows, { onConflict: "gcal_event_id" })` near line 289) is bulk. Before it, fetch the prior rows for these `gcal_event_id`s (there's already a `meetingsByGcalId`-style read in `syncLinkedEvents`; reuse the pattern), diff `starts_at`, collect the `gcal_event_id`s whose `starts_at` moved and whose new `starts_at` is in the future. After the upsert succeeds, look up those meetings' `id, title, starts_at` and call `notifyMeetingChanged` for each. Never fire for a newly-inserted event (no prior row) or a past meeting.

```ts
// sketch inside syncCalendar, around the meeting upsert:
const { data: priorMeetings } = await deps.db
  .from("meeting")
  .select("id, gcal_event_id, starts_at")
  .in("gcal_event_id", meetingRows.map((r) => r.gcal_event_id));
const priorByGcal = new Map(((priorMeetings ?? []) as { id: string; gcal_event_id: string; starts_at: string }[]).map((m) => [m.gcal_event_id, m]));

// ...existing upsert...

const nowMsUpsert = deps.now ? deps.now() : Date.now();
for (const row of meetingRows) {
  const prior = priorByGcal.get(row.gcal_event_id);
  if (!prior) continue; // new event, not a change
  if (prior.starts_at === row.starts_at) continue; // unchanged
  if (new Date(row.starts_at).getTime() <= nowMsUpsert) continue; // past
  try {
    await notifyMeetingChanged(deps.db, { id: prior.id, title: row.title, starts_at: row.starts_at });
  } catch (e) {
    console.error("[gcal] meeting_changed push failed:", e);
  }
}
```

Import `notifyMeetingChanged` from `./meetings`. Confirm `Date.now()` usage matches the file's `deps.now` test seam (gcal.ts already uses `deps.now ? deps.now() : Date.now()`). Add a gcal test: a synced event whose `starts_at` moved fires `notifyMeetingChanged`; an unchanged one and a brand-new one do not.

- [ ] **Step 6: Run tests**

Run: `./dev npm run test -- meetings gcal`
Expected: PASS.

- [ ] **Step 7: Commit & push**

```bash
git add src/lib/meetings.ts src/lib/gcal.ts src/lib/meetings.test.ts src/lib/gcal.test.ts
git commit -m "feat(push): meeting_changed — push + reset reminder stamp when start time moves"
git push
```

---

## Task 12: Docs, env, and final verification

**Files:**
- Create: `docs/setup/web-push.md`, `docs/features/push-notifications.md`
- Modify: `docs/features.md`, `.env.example`

- [ ] **Step 1: `.env.example`**

Add:

```
# Web Push (VAPID). Generate once: ./dev npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:automation@redalert1741.org
```

- [ ] **Step 2: `docs/setup/web-push.md`**

Document: key generation (`./dev npx web-push generate-vapid-keys`), setting the three env vars in Vercel (all environments) and local `.env`, the **rotation warning** (rotating keys invalidates every subscription), the per-env `push_cron_secret` `app_setting` row (must be set in prod or both crons silently no-op — like the FIRST/Slack crons), the two cron `*_url` rows, and the **iOS caveat** (Web Push reaches an iOS PWA only when added to the home screen, 16.4+).

- [ ] **Step 3: `docs/features/push-notifications.md` + `docs/features.md` entry**

Describe the five types, off-by-default behavior, the two-step opt-in (enable device, then per-type toggles), where to manage them (`/me/notifications`), and the iOS install requirement. Add a one-line entry to `docs/features.md` per the docs-layout convention.

- [ ] **Step 4: Update the graph**

Run: `graphify update .`

- [ ] **Step 5: Full gate run**

Run:
```bash
./dev npm run lint
./dev npm run typecheck
./dev npm run test
docker compose up -d && ./dev npm run e2e
```
Expected: all pass. (E2E ~13 min may exceed a 10-min tool cap — run it directly / in the background and report, per the e2e-timeout note.)

- [ ] **Step 6: Commit, push, open PR**

```bash
git add docs .env.example graphify-out
git commit -m "docs(push): setup + feature docs, .env.example, graph update"
git push
gh pr create --base master --title "Push notifications (#248)" --body "$(cat <<'EOF'
Implements #248 — Web Push notifications for five types on one shared VAPID
pipeline, all off by default.

Types: admin_alerts (mirror #hub-admin-alerts), clocked_in_late (nightly),
meeting_reminder (3h before), consent_missing (weekly mentor run),
meeting_changed (on start-time move).

Spec: docs/superpowers/specs/2026-09-06-push-notifications-design.md
Plan: docs/superpowers/plans/2026-09-06-push-notifications.md

## Prod config required after merge
- Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Vercel.
- Set the `push_cron_secret` app_setting row in prod (both crons no-op until set).
- Set `push_clocked_in_late_url` / `push_meeting_reminder_url` app_setting rows to the prod endpoints.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL.

---

## Self-Review

**Spec coverage:**
- Shared core `sendPushToOptedIn` + `pushDepsFromEnv` + sanitizer → Task 3. ✅
- Data model (table, `notification_types`, `reminder_pushed_at`, grant) → Task 1. ✅
- VAPID / three env vars → Tasks 1 (secret row), 3 (env read), 12 (env.example/docs). ✅
- SW + manifest + appleWebApp → Task 4. ✅
- `admin_alerts` (notifyAdmins, passthrough boolean, both producers) → Task 7. ✅
- `clocked_in_late` (open-session set, fixed UTC hour before sweep, shared secret, allowlist) → Task 9. ✅
- `meeting_reminder` ("all", 3h lead, dedupe stamp, hourly) → Task 10. ✅
- `consent_missing` (mentor loop, `/admin/first-status`) → Task 8. ✅
- `meeting_changed` (two write sites, future-only, no-insert, reset stamp) → Task 11. ✅
- API routes (subscribe/unsubscribe/prefs, withRole, role gate, https check) → Task 5. ✅
- UI (`/me/notifications`, home card, iOS hint) → Task 6. ✅
- Error handling (unconfigured no-op, prune, swallow, masquerade 403) → Tasks 3, 5, 7. ✅
- Rollout (per-env config, migration collision check, docs) → Tasks 1, 12. ✅

**Placeholder scan:** No "TBD"/"implement later". Each code step has real code. Two flagged verification points (`Role` includes `captain`; `personFromRow` carries `notification_types`; App-Router icon path) are explicit "confirm X" checks with a fallback, not deferred work.

**Type consistency:** `sendPushToOptedIn(personIds: string[] | "all", type, payload, { db, push })` used identically in Tasks 7–11. `notifyAdmins` returns `boolean` (Task 7) consumed as `delivered` in slack-alerts. `notifyMeetingChanged(db, {id,title,starts_at}, push?)` defined and called consistently in Task 11. `PushDeps` shape consistent across Tasks 3–11.
