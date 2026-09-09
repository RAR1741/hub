import { beforeEach, describe, expect, test, vi } from "vitest";
import { reportSubsystemHealth } from "./system-health";

const sendPushToOptedIn = vi.fn();
vi.mock("./push-dispatch", () => ({
  sendPushToOptedIn: (...args: unknown[]) => sendPushToOptedIn(...args),
  pushDepsFromEnv: () => null,
  sanitizePushText: (s: string) => s,
}));

beforeEach(() => {
  sendPushToOptedIn.mockReset();
});

// Minimal fake app_setting + person store, mirroring slack-alerts.test.ts's fakeDb.
function fakeDb(opts: { state?: Record<string, unknown>; admins?: { id: string }[] } = {}) {
  const store = new Map<string, unknown>(Object.entries(opts.state ?? {}));
  const admins = opts.admins ?? [{ id: "admin-1" }];
  return {
    store,
    from(table: string) {
      if (table === "person") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: admins, error: null });
              },
            };
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

describe("reportSubsystemHealth", () => {
  test("ok→failing with an opted-in admin pushes once and records failing", async () => {
    sendPushToOptedIn.mockResolvedValueOnce({ sent: 1, pruned: 0 });
    const db = fakeDb({ state: { system_health_state_slack_delivery: "ok" } });
    await reportSubsystemHealth("slack_delivery", false, { db: db as never, detail: "token expired" });

    expect(sendPushToOptedIn).toHaveBeenCalledTimes(1);
    const [personIds, type, payload] = sendPushToOptedIn.mock.calls[0];
    expect(personIds).toEqual(["admin-1"]);
    expect(type).toBe("system_health");
    expect(payload.title).toContain("failing");
    expect(payload.body).toBe("token expired");
    expect(payload.url).toBe("/admin");
    expect(db.store.get("system_health_state_slack_delivery")).toBe("failing");
  });

  test("failing→failing does not push; state stays failing", async () => {
    const db = fakeDb({ state: { system_health_state_slack_delivery: "failing" } });
    await reportSubsystemHealth("slack_delivery", false, { db: db as never, detail: "still down" });

    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(db.store.get("system_health_state_slack_delivery")).toBe("failing");
  });

  test("failing→ok pushes a recovered alert and records ok", async () => {
    sendPushToOptedIn.mockResolvedValueOnce({ sent: 1, pruned: 0 });
    const db = fakeDb({ state: { system_health_state_slack_delivery: "failing" } });
    await reportSubsystemHealth("slack_delivery", true, { db: db as never });

    const [, , payload] = sendPushToOptedIn.mock.calls[0];
    expect(payload.title).toContain("recovered");
    expect(db.store.get("system_health_state_slack_delivery")).toBe("ok");
  });

  test("ok→ok (default state) does not push and does not crash", async () => {
    const db = fakeDb();
    await reportSubsystemHealth("slack_delivery", true, { db: db as never });

    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(db.store.get("system_health_state_slack_delivery")).toBe("ok");
  });

  test("ok→failing but sent:0 (nobody opted in) does not advance state", async () => {
    sendPushToOptedIn.mockResolvedValueOnce({ sent: 0, pruned: 0 });
    const db = fakeDb({ state: { system_health_state_slack_delivery: "ok" } });
    await reportSubsystemHealth("slack_delivery", false, { db: db as never });

    expect(sendPushToOptedIn).toHaveBeenCalledTimes(1);
    expect(db.store.get("system_health_state_slack_delivery")).toBe("ok");
  });

  test("zero admins does not call sendPushToOptedIn and does not advance state", async () => {
    const db = fakeDb({ state: { system_health_state_slack_delivery: "ok" }, admins: [] });
    await reportSubsystemHealth("slack_delivery", false, { db: db as never });

    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(db.store.get("system_health_state_slack_delivery")).toBe("ok");
  });

  test("a db whose from() throws resolves without throwing", async () => {
    const db = {
      from() {
        throw new Error("boom");
      },
    };
    await expect(reportSubsystemHealth("slack_delivery", true, { db: db as never })).resolves.toBeUndefined();
  });
});
