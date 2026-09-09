import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";

// route.ts imports @/lib/db, which imports the "server-only" package — that
// throws unconditionally outside a Next.js RSC/webpack build. Mock it so the
// module can be imported under vitest; the handler is called with an
// explicit db anyway, so the mocked getDb is never actually invoked.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { pushTestHandler } from "./route";
import type { Viewer } from "@/lib/viewer";
import type { PushDeps } from "@/lib/push-dispatch";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/push-test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const viewer = { role: "admin", person: { id: "p1" }, masquerade: undefined } as unknown as Viewer;

const PUSH: NonNullable<PushDeps> = {
  publicKey: "pub",
  privateKey: "priv",
  subject: "mailto:dev@example.com",
  send: vi.fn().mockResolvedValue(undefined),
};

test("rejects an invalid/missing type", async () => {
  const db = { from: vi.fn() } as unknown as SupabaseClient;
  const res = await pushTestHandler(viewer, req({}), undefined, db, PUSH);
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json).toEqual({ error: "invalid_type" });
  expect(db.from).not.toHaveBeenCalled();
});

test("valid type dispatches to the caller's own subscriptions, falling back to the type label", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          data: [{ id: "s1", endpoint: "https://push/1", p256dh: "k1", auth: "a1" }],
          error: null,
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const res = await pushTestHandler(viewer, req({ type: "admin_alerts" }), undefined, db, { ...PUSH, send });
  expect(res.status).toBe(200);
  expect(send).toHaveBeenCalledTimes(1);
  const [, body] = send.mock.calls[0] as [unknown, string];
  expect(JSON.parse(body).title).toBe("Admin alerts");
  expect(await res.json()).toEqual({ sent: 1, pruned: 0 });
});

test("unconfigured push returns a no-op without touching the db", async () => {
  const db = { from: vi.fn() } as unknown as SupabaseClient;
  const res = await pushTestHandler(viewer, req({ type: "admin_alerts" }), undefined, db, null);
  expect(await res.json()).toEqual({ sent: 0, pruned: 0, unconfigured: true });
  expect(db.from).not.toHaveBeenCalled();
});
