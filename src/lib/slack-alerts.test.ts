import { describe, expect, test } from "vitest";
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
