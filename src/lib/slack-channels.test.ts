import { describe, expect, test } from "vitest";
import type { SlackDeps } from "./slack";
import {
  channelSlug,
  createEventChannel,
  renameChannel,
  archiveChannel,
  inviteToChannel,
  postToEventChannel,
} from "./slack-channels";

type CapturedRequest = { url: string; init?: RequestInit };

function fakeFetch(responses: { status: number; body?: unknown }[] = []) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: { ok: true } };
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

describe("channelSlug", () => {
  test("lowercases, collapses punctuation, prefixes e-", () => {
    const { base } = channelSlug("Kickoff Meeting!!", "11112222-3333-4444-5555-666677778888");
    expect(base).toBe("e-kickoff-meeting");
  });

  test("long name truncates base to 80 chars", () => {
    const name = "a".repeat(200);
    const { base, suffixed } = channelSlug(name, "11112222-3333-4444-5555-666677778888");
    expect(base.length).toBe(80);
    expect(base).toBe(`e-${"a".repeat(78)}`);
    expect(suffixed.length).toBeLessThanOrEqual(80);
    expect(suffixed).toBe(`e-${"a".repeat(73)}-1111`);
  });

  test("empty / all-punctuation name falls back to uuid prefix", () => {
    const { base } = channelSlug("!!! ---", "abcdef12-3333-4444-5555-666677778888");
    expect(base).toBe("e-abcdef12");
  });

  test("suffixed always ends with first 4 chars of eventId", () => {
    const { suffixed } = channelSlug("Kickoff", "abcd1234-0000-0000-0000-000000000000");
    expect(suffixed).toBe("e-kickoff-abcd");
  });
});

describe("createEventChannel", () => {
  const eventId = "11112222-3333-4444-5555-666677778888";

  test("no token -> null, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await createEventChannel({ fetch: fetchFn, token: null, isProd: true }, "Kickoff", eventId);
    expect(result).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> null, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await createEventChannel(devDeps(fetchFn), "Kickoff", eventId);
    expect(result).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("creates with base name on first success", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true, channel: { id: "C1" } } }]);
    const result = await createEventChannel(prodDeps(fetchFn), "Kickoff", eventId);
    expect(result).toEqual({ id: "C1", name: "e-kickoff" });
    expect(bodyOf(requests[0]).name).toBe("e-kickoff");
  });

  test("name_taken retries once with suffixed name", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "name_taken" } },
      { status: 200, body: { ok: true, channel: { id: "C2" } } },
    ]);
    const result = await createEventChannel(prodDeps(fetchFn), "Kickoff", eventId);
    expect(result).toEqual({ id: "C2", name: "e-kickoff-1111" });
    expect(requests).toHaveLength(2);
    expect(bodyOf(requests[1]).name).toBe("e-kickoff-1111");
  });

  test("both attempts taken -> null", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: false, error: "name_taken" } },
      { status: 200, body: { ok: false, error: "name_taken" } },
    ]);
    const result = await createEventChannel(prodDeps(fetchFn), "Kickoff", eventId);
    expect(result).toBeNull();
  });
});

describe("renameChannel", () => {
  const eventId = "11112222-3333-4444-5555-666677778888";

  test("no token -> null, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await renameChannel({ fetch: fetchFn, token: null, isProd: true }, "C1", "New Name", eventId);
    expect(result).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> null, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await renameChannel(devDeps(fetchFn), "C1", "New Name", eventId);
    expect(result).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("renames to base on success", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const result = await renameChannel(prodDeps(fetchFn), "C1", "New Name", eventId);
    expect(result).toEqual({ name: "e-new-name" });
    expect(bodyOf(requests[0]).channel).toBe("C1");
  });

  test("name_taken retries once with suffixed", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "name_taken" } },
      { status: 200, body: { ok: true } },
    ]);
    const result = await renameChannel(prodDeps(fetchFn), "C1", "New Name", eventId);
    expect(result).toEqual({ name: "e-new-name-1111" });
    expect(requests).toHaveLength(2);
  });
});

describe("archiveChannel", () => {
  test("no token -> false", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await archiveChannel({ fetch: fetchFn, token: null, isProd: true }, "C1");
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> false, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await archiveChannel(devDeps(fetchFn), "C1");
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("already_archived counts as success", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "already_archived" } }]);
    const ok = await archiveChannel(prodDeps(fetchFn), "C1");
    expect(ok).toBe(true);
  });

  test("real success", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const ok = await archiveChannel(prodDeps(fetchFn), "C1");
    expect(ok).toBe(true);
  });

  test("other error -> false", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "channel_not_found" } }]);
    const ok = await archiveChannel(prodDeps(fetchFn), "C1");
    expect(ok).toBe(false);
  });
});

describe("inviteToChannel", () => {
  test("no token -> false, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await inviteToChannel({ fetch: fetchFn, token: null, isProd: true }, "C1", ["U1"]);
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> false, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await inviteToChannel(devDeps(fetchFn), "C1", ["U1"]);
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("already_in_channel counts as success", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "already_in_channel" } }]);
    const ok = await inviteToChannel(prodDeps(fetchFn), "C1", ["U1"]);
    expect(ok).toBe(true);
  });

  test("real success sends comma-joined users", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const ok = await inviteToChannel(prodDeps(fetchFn), "C1", ["U1", "U2"]);
    expect(ok).toBe(true);
    expect(bodyOf(requests[0]).users).toBe("U1,U2");
  });

  test("other error -> false", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "not_in_channel" } }]);
    const ok = await inviteToChannel(prodDeps(fetchFn), "C1", ["U1"]);
    expect(ok).toBe(false);
  });
});

describe("postToEventChannel", () => {
  test("no token -> false, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await postToEventChannel({ fetch: fetchFn, token: null, isProd: true }, "C1", "hi");
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> false, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const ok = await postToEventChannel(devDeps(fetchFn), "C1", "hi");
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("posts message to channel id", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const ok = await postToEventChannel(prodDeps(fetchFn), "C1", "Welcome!");
    expect(ok).toBe(true);
    expect(bodyOf(requests[0]).channel).toBe("C1");
    expect(bodyOf(requests[0]).text).toBe("Welcome!");
  });

  test("network throw is swallowed -> false", async () => {
    const fetchFn = (async () => {
      throw new Error("down");
    }) as unknown as typeof globalThis.fetch;
    const ok = await postToEventChannel(prodDeps(fetchFn), "C1", "hi");
    expect(ok).toBe(false);
  });
});
