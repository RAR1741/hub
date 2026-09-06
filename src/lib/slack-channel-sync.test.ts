import { describe, expect, test } from "vitest";
import type { SlackDeps } from "./slack";
import { CHANNELS } from "./slack-registry";
import { syncSlackMembershipChange } from "./slack-channel-sync";

type CapturedRequest = { url: string; init?: RequestInit };

/** Fake Slack fetch: dispatches on the called method (last URL segment) so both conversations.invite and chat.postMessage can be scripted independently. */
function fakeFetch(responses: Record<string, { status: number; body?: unknown }[]> = {}) {
  const requests: CapturedRequest[] = [];
  const queues: Record<string, { status: number; body?: unknown }[]> = Object.fromEntries(
    Object.entries(responses).map(([k, v]) => [k, [...v]]),
  );
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    requests.push({ url: urlStr, init });
    const method = urlStr.split("/").pop() ?? "";
    const next = queues[method]?.shift() ?? { status: 200, body: { ok: true } };
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

const PERSON = { slack_user_id: "U1", first_name: "Jane", last_name: "Doe", display_name: null };

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

  test("already_in_channel is treated as success, does not throw, no alert", async () => {
    const { fetchFn, requests } = fakeFetch({ "conversations.invite": [{ status: 200, body: { ok: false, error: "already_in_channel" } }] });
    const db = makeDb([{ data: [{ slack_channel_id: "C1", label: "frc" }] }, { data: PERSON }, { data: { name: "FRC Mentors" } }]);
    await expect(
      syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn)),
    ).resolves.toBeUndefined();
    expect(requests.some((r) => r.url.includes("chat.postMessage"))).toBe(false);
  });

  test("happy path: one channel + linked person -> one conversations.invite with channel and user, no alert", async () => {
    const { fetchFn, requests } = fakeFetch({ "conversations.invite": [{ status: 200, body: { ok: true } }] });
    const db = makeDb([{ data: [{ slack_channel_id: "C1", label: "frc" }] }, { data: PERSON }, { data: { name: "FRC Mentors" } }]);
    await syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("conversations.invite");
    expect(bodyOf(requests[0])).toMatchObject({ channel: "C1", users: "U1" });
    expect(requests.some((r) => r.url.includes("chat.postMessage"))).toBe(false);
  });

  test("not_in_channel -> posts one alert to #hub-admin-alerts naming the person, channel and team", async () => {
    const { fetchFn, requests } = fakeFetch({
      "conversations.invite": [{ status: 200, body: { ok: false, error: "not_in_channel" } }],
      "chat.postMessage": [{ status: 200, body: { ok: true } }],
    });
    const db = makeDb([{ data: [{ slack_channel_id: "C1", label: "#frc" }] }, { data: PERSON }, { data: { name: "FRC Mentors" } }]);
    await syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn));

    const alerts = requests.filter((r) => r.url.includes("chat.postMessage"));
    expect(alerts).toHaveLength(1);
    const alertBody = bodyOf(alerts[0]);
    expect(alertBody.channel).toBe(CHANNELS["hub-admin-alerts"]);
    expect(alertBody.text as string).toContain("Jane Doe");
    expect(alertBody.text as string).toContain("#frc (");
    expect(alertBody.text as string).not.toContain("##");
    expect(alertBody.text as string).toContain("C1");
    expect(alertBody.text as string).toContain("FRC Mentors");
    expect(alertBody.text as string).toContain("not_in_channel");
  });

  test("team_slack_channel query error -> logged and swallowed, never throws", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([{ data: null, error: { message: "boom" } }]); // team_slack_channel
    await expect(
      syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn)),
    ).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  test("person query error -> logged and swallowed, never throws", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([
      { data: [{ slack_channel_id: "C1" }] }, // team_slack_channel
      { data: null, error: { message: "boom" } }, // person
    ]);
    await expect(
      syncSlackMembershipChange("add", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn)),
    ).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  test("action remove -> immediate no-op, no db access", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([]);
    await syncSlackMembershipChange("remove", "team-1", "person-1", db as never, fakeSlackDeps(fetchFn));
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });
});
