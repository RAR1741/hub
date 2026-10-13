import { beforeEach, expect, test, vi } from "vitest";

// event-signups -> @/lib/db imports "server-only"; the lib is mocked wholesale.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/event-signups", () => ({ setEventPersonNote: vi.fn() }));
vi.mock("@/lib/viewer", () => ({
  getViewer: () => Promise.resolve({ role: "mentor", person: { id: "m1" } }),
}));

import { PUT } from "./route";
import { setEventPersonNote } from "@/lib/event-signups";

const ID = "11111111-1111-1111-1111-111111111111";
const PID = "22222222-2222-2222-2222-222222222222";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

function req(body: unknown) {
  return new Request(`http://localhost/api/admin/events/${ID}/note`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.mocked(setEventPersonNote).mockReset();
  vi.mocked(setEventPersonNote).mockResolvedValue({ ok: true, status: 200 });
});

test("400 on bad event id, bad person id, or a note over 500 chars", async () => {
  expect((await PUT(req({ personId: PID, note: "x" }), ctx("nope"))).status).toBe(400);
  expect((await PUT(req({ personId: "nope", note: "x" }), ctx())).status).toBe(400);
  expect((await PUT(req({ personId: PID, note: "x".repeat(501) }), ctx())).status).toBe(400);
  expect(setEventPersonNote).not.toHaveBeenCalled();
});

test("a blank note clears it (null)", async () => {
  const res = await PUT(req({ personId: PID, note: "   " }), ctx());
  expect(res.status).toBe(200);
  expect(setEventPersonNote).toHaveBeenCalledWith(ID, PID, null, "m1");
});

test("a valid note is trimmed and attributed to the viewer", async () => {
  await PUT(req({ personId: PID, note: "  bring badge " }), ctx());
  expect(setEventPersonNote).toHaveBeenCalledWith(ID, PID, "bring badge", "m1");
});

test("passes through the lib failure status", async () => {
  vi.mocked(setEventPersonNote).mockResolvedValue({ ok: false, status: 400 });
  const res = await PUT(req({ personId: PID, note: "x" }), ctx());
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "failed" });
});
