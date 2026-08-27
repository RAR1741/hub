import { describe, expect, test } from "vitest";
import { CHANNELS } from "./slack-registry";
import { postChannelMessage, sendDM, type SlackDeps } from "./slack";

type CapturedRequest = { url: string; init?: RequestInit };

function fakeFetch(responses: { status: number; body?: unknown }[] = []) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: { ok: true, channel: { id: "D123" } } };
    return new Response(next.body !== undefined ? JSON.stringify(next.body) : undefined, {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, requests };
}

const prodDeps = (fetchFn: typeof globalThis.fetch): SlackDeps => ({ fetch: fetchFn, token: "xoxb-test", isProd: true });
const devDeps = (fetchFn: typeof globalThis.fetch): SlackDeps => ({ fetch: fetchFn, token: "xoxb-test", isProd: false });

function bodyOf(req: CapturedRequest) {
  return JSON.parse(req.init!.body as string) as Record<string, unknown>;
}

describe("postChannelMessage", () => {
  test("posts to chat.postMessage with the resolved channel id and bearer token", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const ok = await postChannelMessage(prodDeps(fetchFn), "hub_alerts", "hello");
    expect(ok).toBe(true);
    const req = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect((req.init?.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
    expect(bodyOf(req).channel).toBe(CHANNELS.hub_alerts);
    expect(bodyOf(req).text).toBe("hello");
  });

  test("non-production redirects the message to bot_test with a preface", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    await postChannelMessage(devDeps(fetchFn), "hub_alerts", "hello");
    const req = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect(bodyOf(req).channel).toBe(CHANNELS.bot_test);
    expect(String(bodyOf(req).text)).toContain("hub_alerts");
    expect(String(bodyOf(req).text)).toContain("hello");
  });

  test("no token → no request, returns false", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await postChannelMessage({ fetch: fetchFn, token: null, isProd: true }, "hub_alerts", "hi");
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("Slack API error (ok:false) is swallowed, returns false", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "channel_not_found" } }]);
    const ok = await postChannelMessage(prodDeps(fetchFn), "hub_alerts", "hi");
    expect(ok).toBe(false);
  });

  test("network throw is swallowed, returns false", async () => {
    const fetchFn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const ok = await postChannelMessage(prodDeps(fetchFn), "hub_alerts", "hi");
    expect(ok).toBe(false);
  });
});

describe("sendDM", () => {
  test("production opens a conversation then posts to the returned channel id", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, channel: { id: "D999" } } }, // conversations.open
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    const ok = await sendDM(prodDeps(fetchFn), "U123", "your items");
    expect(ok).toBe(true);
    expect(requests[0].url).toContain("conversations.open");
    expect(bodyOf(requests[0]).users).toBe("U123");
    expect(requests[1].url).toContain("chat.postMessage");
    expect(bodyOf(requests[1]).channel).toBe("D999");
  });

  test("non-production sends to bot_test instead of opening a DM", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    await sendDM(devDeps(fetchFn), "U123", "your items");
    expect(requests.every((r) => !r.url.includes("conversations.open"))).toBe(true);
    const post = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect(bodyOf(post).channel).toBe(CHANNELS.bot_test);
    expect(String(bodyOf(post).text)).toContain("U123");
  });
});
