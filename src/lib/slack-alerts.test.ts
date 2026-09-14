import { describe, expect, test } from "vitest";
import { reportSyncOutcome } from "./slack-alerts";

// Minimal fake app_setting store honoring getSetting's .select().eq().maybeSingle()
// and .upsert(). Mirror the shape getSetting/first-sync use. Also fakes sync_run inserts.
function fakeDb(initial: Record<string, unknown> = {}, opts: { insertShouldThrow?: boolean } = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const inserted: Record<string, unknown>[] = [];
  return {
    store,
    inserted,
    from(table: string) {
      if (table === "sync_run") {
        return {
          async insert(row: Record<string, unknown>) {
            if (opts.insertShouldThrow) return { error: new Error("insert failed") };
            inserted.push(row);
            return { error: null };
          },
        };
      }
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

  test("ok→failing with undelivered post does not advance state (re-alerts next run)", async () => {
    const db = fakeDb({ slack_alert_state_first_sync: "ok" });
    // Slack API call fails (e.g. token not yet configured post-deploy) — postChannelMessage returns false.
    const fetchFn = (async () => new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 })) as unknown as typeof globalThis.fetch;
    const deps = { fetch: fetchFn, token: "xoxb", isProd: true };
    await reportSyncOutcome("first_sync", false, { db: db as never, slack: deps, error: "session expired" });
    expect(db.store.get("slack_alert_state_first_sync")).toBe("ok");
  });

  test("writes a sync_run row on the success path", async () => {
    const db = fakeDb();
    const { deps } = spySlack();
    await reportSyncOutcome("drive_sync", true, { db: db as never, slack: deps, startedAt: 123, detail: { added: 2 } });
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ source: "drive_sync", ok: true, detail: { added: 2 } });
  });

  test("writes a sync_run row on the failure path", async () => {
    const db = fakeDb({ slack_alert_state_first_sync: "ok" });
    const { deps } = spySlack();
    await reportSyncOutcome("first_sync", false, { db: db as never, slack: deps, error: "session expired" });
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ source: "first_sync", ok: false, error: "session expired" });
  });

  test("still posts the alert when the sync_run insert throws", async () => {
    const db = fakeDb({ slack_alert_state_first_sync: "ok" }, { insertShouldThrow: true });
    const { posts, deps } = spySlack();
    await reportSyncOutcome("first_sync", false, { db: db as never, slack: deps, error: "session expired" });
    expect(posts).toHaveLength(1);
    expect(db.store.get("slack_alert_state_first_sync")).toBe("failing");
  });

  test("Error input stores the stack in the row but only the message in Slack", async () => {
    const db = fakeDb({ slack_alert_state_first_sync: "ok" });
    const { posts, deps } = spySlack();
    const err = new Error("session expired");
    await reportSyncOutcome("first_sync", false, { db: db as never, slack: deps, error: err });
    expect(db.inserted[0].error).toBe(err.stack);
    expect(posts[0].text).toContain("session expired");
    expect(posts[0].text).not.toContain(err.stack!.split("\n")[1] ?? "__no_second_line__");
  });
});
