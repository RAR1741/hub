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
      { id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1", person: { is_active: true, notification_types: ["admin_alerts"] } },
      { id: "s2", endpoint: "https://push/2", p256dh: "k2", auth: "a2", person: { is_active: true, notification_types: ["admin_alerts"] } },
    ]);
    const res = await sendPushToOptedIn(["p1"], "admin_alerts", { title: "t", body: "b", url: "/x" }, { db, push: { ...PUSH, send } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(res.sent).toBe(2);
  });

  test("prunes a subscription on 404/410", async () => {
    const send = vi.fn().mockRejectedValue({ statusCode: 410 });
    const db = fakeDb([{ id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1", person: { is_active: true, notification_types: ["admin_alerts"] } }]);
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
      { id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1", person: { is_active: true, notification_types: ["admin_alerts"] } },
      { id: "s2", endpoint: "https://push/2", p256dh: "k2", auth: "a2", person: { is_active: true, notification_types: ["admin_alerts"] } },
    ]);
    const res = await sendPushToOptedIn(["p1"], "admin_alerts", { title: "t", body: "b", url: "/" }, { db, push: { ...PUSH, send } });
    expect(res.sent).toBe(1); // s2 only
    expect(res.pruned).toBe(0); // 500 is not a prune
  });
});
