import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";

// route.ts imports @/lib/db, which imports the "server-only" package — that
// throws unconditionally outside a Next.js RSC/webpack build. Mock it so the
// module can be imported under vitest; the handler is called with an
// explicit db anyway, so the mocked getDb is never actually invoked.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

// Build a request + fake viewer, call the exported handler via withRole's
// viewerSource injection. Because the route wires withRole at module scope,
// test the inner logic by importing the handler it wraps. Export the inner
// handler from the route for testability (see implementation).
import { subscribeHandler } from "./route";
import type { Viewer } from "@/lib/viewer";

function req(body: unknown, method = "POST") {
  return new Request("http://localhost/api/push/subscribe", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const viewer = { role: "student", person: { id: "p1" }, masquerade: undefined } as unknown as Viewer;

test("rejects a non-https endpoint", async () => {
  const db = { from: vi.fn() } as unknown as SupabaseClient;
  const res = await subscribeHandler(viewer, req({ endpoint: "http://push/1", keys: { p256dh: "k", auth: "a" } }), undefined, db);
  expect(res.status).toBe(400);
  expect(db.from).not.toHaveBeenCalled();
});

test("upserts a valid subscription for the viewer", async () => {
  const upsert = vi.fn().mockReturnValue({ error: null });
  const db = { from: () => ({ upsert }) } as unknown as SupabaseClient;
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
