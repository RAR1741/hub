import { describe, expect, test, vi } from "vitest";

// route.ts imports @/lib/db, which imports the "server-only" package — that
// throws unconditionally outside a Next.js RSC/webpack build. Mock it so the
// module can be imported under vitest; the handler is called with an
// explicit db anyway, so the mocked getDb is never actually invoked.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

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
