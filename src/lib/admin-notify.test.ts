import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import type { SlackDeps } from "./slack";
import { notifyAdmins } from "./admin-notify";

vi.mock("./slack", async (orig) => {
  const actual = await orig<typeof import("./slack")>();
  return { ...actual, postChannelMessage: vi.fn() };
});
vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sanitizePushText: (s: string) => s,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 0, pruned: 0 }),
}));

import { postChannelMessage } from "./slack";
import { sendPushToOptedIn } from "./push-dispatch";

const mockPostChannelMessage = vi.mocked(postChannelMessage);
const mockSendPushToOptedIn = vi.mocked(sendPushToOptedIn);

function adminIdsDb(ids: string[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ data: ids.map((id) => ({ id })), error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const slack = {} as SlackDeps;

describe("notifyAdmins", () => {
  test("returns Slack's delivered boolean unchanged (true)", async () => {
    mockPostChannelMessage.mockResolvedValue(true);
    const res = await notifyAdmins("hi", { db: adminIdsDb(["a1"]), slack });
    expect(res).toBe(true);
  });

  test("returns false when Slack post failed, even if push succeeds", async () => {
    mockPostChannelMessage.mockResolvedValue(false);
    mockSendPushToOptedIn.mockResolvedValue({ sent: 3, pruned: 0 });
    const res = await notifyAdmins("hi", { db: adminIdsDb(["a1"]), slack });
    expect(res).toBe(false);
  });

  test("a throwing push fan-out does not change the return value", async () => {
    mockPostChannelMessage.mockResolvedValue(true);
    mockSendPushToOptedIn.mockRejectedValue(new Error("boom"));
    const res = await notifyAdmins("hi", { db: adminIdsDb(["a1"]), slack });
    expect(res).toBe(true);
  });
});
