import { beforeEach, expect, test, vi } from "vitest";

// route.ts -> @/lib/parts -> @/lib/db imports "server-only", which throws
// outside a Next RSC/webpack build; parts is mocked wholesale anyway.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/parts", () => ({
  updatePart: vi.fn(),
  deletePart: vi.fn(),
  parsePartPatch: (body: unknown) => body as { status: string },
}));
vi.mock("@/lib/realtime", () => ({ broadcast: vi.fn() }));
vi.mock("@/lib/viewer", () => ({
  getViewer: () => Promise.resolve({ role: "student", person: { id: "p1" } }),
}));

import { DELETE, PATCH } from "./route";
import { deletePart, updatePart } from "@/lib/parts";
import { broadcast } from "@/lib/realtime";

const ID = "11111111-1111-1111-1111-111111111111";
const ctx = { params: Promise.resolve({ id: ID }) };

function req(method: string, body?: unknown) {
  return new Request(`http://localhost/api/admin/parts/${ID}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => vi.mocked(broadcast).mockClear());

test("a successful PATCH broadcasts hub:parts so the shop board refetches", async () => {
  vi.mocked(updatePart).mockResolvedValue({ ok: true, status: 200 });
  const res = await PATCH(req("PATCH", { status: "done" }), ctx);
  expect(res.status).toBe(200);
  expect(broadcast).toHaveBeenCalledWith("hub:parts", "part-update");
});

test("a failed PATCH does not broadcast", async () => {
  vi.mocked(updatePart).mockResolvedValue({ ok: false, status: 404 });
  const res = await PATCH(req("PATCH", { status: "done" }), ctx);
  expect(res.status).toBe(404);
  expect(broadcast).not.toHaveBeenCalled();
});

test("a successful DELETE broadcasts, a failed one does not", async () => {
  vi.mocked(deletePart).mockResolvedValue({ ok: true, status: 200 });
  expect((await DELETE(req("DELETE"), ctx)).status).toBe(200);
  expect(broadcast).toHaveBeenCalledWith("hub:parts", "part-delete");

  vi.mocked(broadcast).mockClear();
  vi.mocked(deletePart).mockResolvedValue({ ok: false, status: 409 });
  expect((await DELETE(req("DELETE"), ctx)).status).toBe(409);
  expect(broadcast).not.toHaveBeenCalled();
});
