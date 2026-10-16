import { beforeEach, expect, test, vi } from "vitest";

// route.ts -> @/lib/cron-jobs -> @/lib/db imports "server-only"; mock db and
// stub only runCronJob, keeping parseRunInput real.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/cron-jobs", async (orig) => ({
  ...(await orig<typeof import("@/lib/cron-jobs")>()),
  runCronJob: vi.fn(),
}));
const getViewer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/viewer", () => ({ getViewer }));

import { POST } from "./route";
import { runCronJob } from "@/lib/cron-jobs";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/cron", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.mocked(runCronJob).mockReset();
  getViewer.mockResolvedValue({ role: "admin", person: { id: "p1" } });
});

test("non-admin gets 403", async () => {
  getViewer.mockResolvedValue({ role: "mentor", person: { id: "p2" } });
  const res = await POST(req({ jobId: 1 }), undefined);
  expect(res.status).toBe(403);
  expect(runCronJob).not.toHaveBeenCalled();
});

test("bad body gets 400", async () => {
  const res = await POST(req({ jobId: "x" }), undefined);
  expect(res.status).toBe(400);
  expect(runCronJob).not.toHaveBeenCalled();
});

test("valid body runs the job", async () => {
  vi.mocked(runCronJob).mockResolvedValue({ ok: true, status: 200 });
  const res = await POST(req({ jobId: 4 }), undefined);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(runCronJob).toHaveBeenCalledWith({ jobId: 4 });
});
