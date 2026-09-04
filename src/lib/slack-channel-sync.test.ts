import { describe, expect, test } from "vitest";
import type { SlackDeps } from "./slack";
import { syncSlackMembershipChange } from "./slack-channel-sync";

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

function bodyOf(req: CapturedRequest) {
  return JSON.parse(req.init!.body as string) as Record<string, unknown>;
}

function fakeSlackDeps(fetchFn: typeof globalThis.fetch): SlackDeps {
  return { fetch: fetchFn, token: "xoxb-test", isProd: true };
}

/** Minimal chainable fake db, mirroring slack-channels.test.ts's makeDb. */
function makeDb(script: { data?: unknown; error?: unknown }[]) {
  const queue = [...script];
  const calls: string[] = [];
  function chain(result: { data?: unknown; error?: unknown }) {
    const obj: Record<string, unknown> = {
      select: () => obj,
      eq: () => obj,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (r: unknown) => unknown) => resolve(result),
    };
    return obj;
  }
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const result = queue.shift() ?? { data: null, error: null };
      return chain(result);
    },
  };
}

describe("syncSlackMembershipChange", () => {
  test("no token -> no-op, no db access, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([]);
    await syncSlackMembershipChange("add", "team-1", "person-1", db as never, { fetch: fetchFn, token: null, isProd: true });
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });

  test("no linked channels -> no invite fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([{ data: [] }]); // team_slack_channel query
    await syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn));
    expect(db.calls).toEqual(["team_slack_channel"]);
    expect(requests).toHaveLength(0);
  });

  test("person has no slack_user_id -> no invite fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([
      { data: [{ slack_channel_id: "C1" }] }, // team_slack_channel
      { data: { slack_user_id: null } }, // person
    ]);
    await syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn));
    expect(db.calls).toEqual(["team_slack_channel", "person"]);
    expect(requests).toHaveLength(0);
  });

  test("already_in_channel is treated as success, does not throw", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "already_in_channel" } }]);
    const db = makeDb([{ data: [{ slack_channel_id: "C1" }] }, { data: { slack_user_id: "U1" } }]);
    await expect(
      syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn)),
    ).resolves.toBeUndefined();
  });

  test("happy path: one channel + linked person -> one conversations.invite with channel and user", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const db = makeDb([{ data: [{ slack_channel_id: "C1" }] }, { data: { slack_user_id: "U1" } }]);
    await syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("conversations.invite");
    expect(bodyOf(requests[0])).toMatchObject({ channel: "C1", users: "U1" });
  });

  test("action remove -> immediate no-op, no db access", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([]);
    await syncSlackMembershipChange("remove", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn));
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });
});
