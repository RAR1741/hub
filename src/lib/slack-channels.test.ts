import { describe, expect, test } from "vitest";
import type { SlackDeps } from "./slack";
import {
  channelSlug,
  createEventChannel,
  renameChannel,
  renameChannelDetailed,
  archiveChannel,
  inviteToChannel,
  inviteToChannelDetailed,
  listChannelMembers,
  postToEventChannel,
  afterEventCreated,
  afterEventUpdated,
  afterEventSignup,
  sweepEventChannels,
  isChannelArchived,
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

describe("renameChannelDetailed", () => {
  test("failure carries the Slack error code; skip has none", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "restricted_action" } }]);
    expect(await renameChannelDetailed(prodDeps(fetchFn), "C1", "New", "11112222-x")).toEqual({ ok: false, error: "restricted_action" });
    expect(await renameChannelDetailed(devDeps(fetchFn), "C1", "New", "11112222-x")).toEqual({ ok: false });
  });
});

describe("archiveChannel", () => {
  test("no token -> not ok, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const res = await archiveChannel({ fetch: fetchFn, token: null, isProd: true }, "C1");
    expect(res).toEqual({ ok: false });
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> not ok, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const res = await archiveChannel(devDeps(fetchFn), "C1");
    expect(res).toEqual({ ok: false });
    expect(requests).toHaveLength(0);
  });

  test("already_archived counts as success", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "already_archived" } }]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: true });
  });

  test("real success", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: true } }]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: true });
  });

  test("other error carries its code", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "restricted_action" } }]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: false, error: "restricted_action" });
  });

  test("not_in_channel -> join -> retry archive succeeds", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "not_in_channel" } },
      { status: 200, body: { ok: true } }, // conversations.join
      { status: 200, body: { ok: true } }, // retry archive
    ]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: true });
    expect(requests.map((r) => r.url.split("/").pop())).toEqual(["conversations.archive", "conversations.join", "conversations.archive"]);
    expect(bodyOf(requests[1])).toEqual({ channel: "C1" });
  });

  test("not_in_channel, join fails -> join error code", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "not_in_channel" } },
      { status: 200, body: { ok: false, error: "missing_scope" } },
    ]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: false, error: "join:missing_scope" });
    expect(requests).toHaveLength(2);
  });

  test("not_in_channel, join says is_archived -> success", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: false, error: "not_in_channel" } },
      { status: 200, body: { ok: false, error: "is_archived" } },
    ]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: true });
  });

  test("retry returning already_archived counts as success", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: false, error: "not_in_channel" } },
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: false, error: "already_archived" } },
    ]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: true });
  });

  test("retry failing with restricted_action carries that code", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: false, error: "not_in_channel" } },
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: false, error: "restricted_action" } },
    ]);
    expect(await archiveChannel(prodDeps(fetchFn), "C1")).toEqual({ ok: false, error: "restricted_action" });
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

describe("inviteToChannelDetailed", () => {
  test("no token -> skip ({ ok: false }, no error), no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await inviteToChannelDetailed({ fetch: fetchFn, token: null, isProd: true }, "C1", ["U1"]);
    expect(result).toEqual({ ok: false });
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> skip ({ ok: false }, no error), no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await inviteToChannelDetailed(devDeps(fetchFn), "C1", ["U1"]);
    expect(result).toEqual({ ok: false });
    expect(requests).toHaveLength(0);
  });

  test("already_in_channel -> { ok: true }", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "already_in_channel" } }]);
    const result = await inviteToChannelDetailed(prodDeps(fetchFn), "C1", ["U1"]);
    expect(result).toEqual({ ok: true });
  });

  test("real success -> { ok: true }", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const result = await inviteToChannelDetailed(prodDeps(fetchFn), "C1", ["U1"]);
    expect(result).toEqual({ ok: true });
  });

  test("other Slack error -> { ok: false, error } carries the code", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "not_in_channel" } }]);
    const result = await inviteToChannelDetailed(prodDeps(fetchFn), "C1", ["U1"]);
    expect(result).toEqual({ ok: false, error: "not_in_channel" });
  });

  test("network throw -> { ok: false, error } carries the message", async () => {
    const fetchFn = (async () => {
      throw new Error("down");
    }) as unknown as typeof globalThis.fetch;
    const result = await inviteToChannelDetailed(prodDeps(fetchFn), "C1", ["U1"]);
    expect(result).toEqual({ ok: false, error: "down" });
  });
});

describe("listChannelMembers", () => {
  test("no token -> not_configured, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await listChannelMembers({ fetch: fetchFn, token: null, isProd: true }, "C1");
    expect(result).toEqual({ ok: false, error: "not_configured" });
    expect(requests).toHaveLength(0);
  });

  test("non-prod -> not_configured, no fetch", async () => {
    const { fetchFn, requests } = fakeFetch();
    const result = await listChannelMembers(devDeps(fetchFn), "C1");
    expect(result).toEqual({ ok: false, error: "not_configured" });
    expect(requests).toHaveLength(0);
  });

  test("single page returns the members and GETs the channel", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, members: ["U1", "U2"], response_metadata: { next_cursor: "" } } },
    ]);
    const result = await listChannelMembers(prodDeps(fetchFn), "C1");
    expect(result).toEqual({ ok: true, members: ["U1", "U2"] });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("conversations.members");
    expect(requests[0].url).toContain("channel=C1");
    expect((requests[0].init as RequestInit).method).toBe("GET");
  });

  test("follows next_cursor and concatenates pages", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, members: ["U1"], response_metadata: { next_cursor: "CUR2" } } },
      { status: 200, body: { ok: true, members: ["U2", "U3"], response_metadata: { next_cursor: "" } } },
    ]);
    const result = await listChannelMembers(prodDeps(fetchFn), "C1");
    expect(result).toEqual({ ok: true, members: ["U1", "U2", "U3"] });
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("cursor=CUR2");
  });

  test("Slack error -> { ok: false, error } carries the code", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "channel_not_found" } }]);
    const result = await listChannelMembers(prodDeps(fetchFn), "C1");
    expect(result).toEqual({ ok: false, error: "channel_not_found" });
  });

  test("network throw -> { ok: false, error } carries the message", async () => {
    const fetchFn = (async () => {
      throw new Error("down");
    }) as unknown as typeof globalThis.fetch;
    const result = await listChannelMembers(prodDeps(fetchFn), "C1");
    expect(result).toEqual({ ok: false, error: "down" });
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

// --- Orchestrator tests -----------------------------------------------

const EVENT_ID = "11112222-3333-4444-5555-666677778888";

/**
 * A minimal chainable fake db: `from(table)` returns the next queued result
 * for that table (in call order), wrapped in an object where every query
 * builder method (select/not/is/eq/in/update) returns itself so any chain
 * length works, and the object is thenable (mirrors supabase-js query
 * builders resolving on await) plus supports an explicit `.maybeSingle()`.
 */
function makeDb(script: { data?: unknown; error?: unknown }[]) {
  const queue = [...script];
  const calls: string[] = [];
  const updates: unknown[] = [];
  function chain(result: { data?: unknown; error?: unknown }) {
    const obj: Record<string, unknown> = {
      select: () => obj,
      not: () => obj,
      is: () => obj,
      eq: () => obj,
      in: () => obj,
      update: (payload: unknown) => {
        updates.push(payload);
        return obj;
      },
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (r: unknown) => unknown) => resolve(result),
    };
    return obj;
  }
  return {
    calls,
    updates,
    from(table: string) {
      calls.push(table);
      const result = queue.shift() ?? { data: null, error: null };
      return chain(result);
    },
  };
}

function fakeSlackDeps(fetchFn: typeof globalThis.fetch): SlackDeps {
  return { fetch: fetchFn, token: "xoxb-test", isProd: true };
}

describe("afterEventCreated", () => {
  test("persists channel id/name and invites a linked creator", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, channel: { id: "C1" } } }, // conversations.create
      { status: 200, body: { ok: true } }, // conversations.invite
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    const db = makeDb([
      { error: null }, // event update (channel id/name)
      { data: { slack_user_id: "U-CREATOR" } }, // person lookup
      { data: null }, // team_timezone setting lookup (falls back to default)
    ]);

    await afterEventCreated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "Kickoff", createdBy: "creator-1", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-01T02:00:00Z", location: null },
    );

    expect(db.calls).toEqual(["event", "person", "app_setting"]);
    // create, invite, post
    expect(requests).toHaveLength(3);
    expect(requests[1].url).toContain("conversations.invite");
    expect(bodyOf(requests[1]).users).toBe("U-CREATOR");
    // kickoff message deep-links this event's show page for sign-ups
    expect(requests[2].url).toContain("chat.postMessage");
    expect(bodyOf(requests[2]).text).toContain(`<https://hub.redalert1741.org/events/${EVENT_ID}|Sign up here!>`);
  });

  test("unlinked creator: channel still created, no invite call", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, channel: { id: "C1" } } },
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    const db = makeDb([{ error: null }, { data: { slack_user_id: null } }]);

    await afterEventCreated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "Kickoff", createdBy: "creator-1", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-01T02:00:00Z", location: null },
    );

    expect(requests.some((r) => r.url.includes("conversations.invite"))).toBe(false);
  });

  test("persist failure archives the just-created channel and skips invite/post", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, channel: { id: "C1" } } }, // conversations.create
      { status: 200, body: { ok: true } }, // conversations.archive (cleanup)
    ]);
    const db = makeDb([{ error: { message: "db down" } }]); // event update fails

    await afterEventCreated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "Kickoff", createdBy: "creator-1", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-01T02:00:00Z", location: null },
    );

    expect(db.calls).toEqual(["event"]);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("conversations.archive");
  });

  test("person lookup error: skips invite, still posts kickoff message", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, channel: { id: "C1" } } }, // conversations.create
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    const db = makeDb([{ error: null }, { data: null, error: { message: "lookup failed" } }]);

    await afterEventCreated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "Kickoff", createdBy: "creator-1", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-01T02:00:00Z", location: null },
    );

    expect(requests.some((r) => r.url.includes("conversations.invite"))).toBe(false);
    expect(requests.some((r) => r.url.includes("chat.postMessage"))).toBe(true);
  });
});

describe("afterEventUpdated", () => {
  test("no-op when stored name already matches the base candidate", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([]);
    await afterEventUpdated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "Kickoff", slackChannelId: "C1", slackChannelName: "e-kickoff", slackArchivedAt: null },
    );
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });

  test("no-op when stored name already matches the suffixed candidate", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([]);
    await afterEventUpdated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "Kickoff", slackChannelId: "C1", slackChannelName: "e-kickoff-1111", slackArchivedAt: null },
    );
    expect(requests).toHaveLength(0);
  });

  test("skips archived channels entirely", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([]);
    await afterEventUpdated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "New Name", slackChannelId: "C1", slackChannelName: "e-kickoff", slackArchivedAt: "2026-09-01T00:00:00Z" },
    );
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });

  test("renames and persists the new name when neither candidate matches", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const db = makeDb([{ error: null }]);
    await afterEventUpdated(
      { db: db as never, slack: fakeSlackDeps(fetchFn) },
      { id: EVENT_ID, name: "Renamed Event", slackChannelId: "C1", slackChannelName: "e-kickoff", slackArchivedAt: null },
    );
    expect(db.calls).toEqual(["event"]);
  });
});

describe("afterEventSignup", () => {
  test("sets slack_invited_at only when the invite succeeds", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const db = makeDb([{ data: { slack_user_id: "U1" } }, { error: null }]);
    await afterEventSignup({ db: db as never, slack: fakeSlackDeps(fetchFn) }, { id: EVENT_ID, slackChannelId: "C1", slackArchivedAt: null }, "person-1");
    expect(db.calls).toEqual(["person", "event_signup"]);
  });

  test("unlinked person: no-op, leaves slack_invited_at untouched", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([{ data: { slack_user_id: null } }]);
    await afterEventSignup({ db: db as never, slack: fakeSlackDeps(fetchFn) }, { id: EVENT_ID, slackChannelId: "C1", slackArchivedAt: null }, "person-1");
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual(["person"]); // no event_signup write
  });

  test("failed invite does not write slack_invited_at", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "not_in_channel" } }]);
    const db = makeDb([{ data: { slack_user_id: "U1" } }]);
    await afterEventSignup({ db: db as never, slack: fakeSlackDeps(fetchFn) }, { id: EVENT_ID, slackChannelId: "C1", slackArchivedAt: null }, "person-1");
    expect(db.calls).toEqual(["person"]);
  });

  test("skips events without a channel", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([]);
    await afterEventSignup({ db: db as never, slack: fakeSlackDeps(fetchFn) }, { id: EVENT_ID, slackChannelId: null, slackArchivedAt: null }, "person-1");
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });

  test("person lookup error: no-op, no invite call", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([{ data: null, error: { message: "lookup failed" } }]);
    await afterEventSignup({ db: db as never, slack: fakeSlackDeps(fetchFn) }, { id: EVENT_ID, slackChannelId: "C1", slackArchivedAt: null }, "person-1");
    expect(requests).toHaveLength(0);
    expect(db.calls).toEqual(["person"]);
  });
});

describe("sweepEventChannels", () => {
  const noSleep = { sleep: async () => {} };

  test("archives only events ended more than 7 days ago", async () => {
    const oldEnded = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const stillLive = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: true } }, // archive old event
    ]);
    const db = makeDb([
      {
        data: [
          { id: "e-old", name: "Old Event", ends_at: oldEnded, slack_channel_id: "C-OLD", slack_channel_name: "e-old-event" },
          { id: "e-live", name: "Live Event", ends_at: stillLive, slack_channel_id: "C-LIVE", slack_channel_name: "e-live-event" },
        ],
      }, // events query
      { error: null }, // persist archived_at for e-old
      { data: [] }, // signup sweep query (surviving events only)
    ]);

    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });

    expect(result.archived).toBe(1);
    expect(result.failed).toBe(0);
  });

  test("archive failure is recorded with event, channel and Slack error code", async () => {
    const oldEnded = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: false, error: "restricted_action" } },
      { status: 200, body: { ok: true, channel: { is_archived: false } } }, // conversations.info: open
    ]);
    const db = makeDb([
      { data: [{ id: "e-old", name: "Tinker Fest", ends_at: oldEnded, slack_channel_id: "C-OLD", slack_channel_name: "e-tinker-fest-de23" }] },
    ]);

    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });

    expect(result.archived).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([{ event: "Tinker Fest", channel: "e-tinker-fest-de23", op: "archive", error: "restricted_action" }]);
  });

  test("dev/no-token skips are not counted or recorded as failures", async () => {
    const oldEnded = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn } = fakeFetch();
    const db = makeDb([{ data: [{ id: "e-old", name: "Old", ends_at: oldEnded, slack_channel_id: "C-OLD", slack_channel_name: "e-old" }] }]);
    const result = await sweepEventChannels({ db: db as never, slack: devDeps(fetchFn), ...noSleep });
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
  });

  test("rename failure carries the Slack error code", async () => {
    const stillLive = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "channel_not_found" } }]);
    const db = makeDb([{ data: [{ id: "e1", name: "Renamed", ends_at: stillLive, slack_channel_id: "C1", slack_channel_name: "e-old" }] }, { data: [] }]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.failures).toEqual([{ event: "Renamed", channel: "e-old", op: "rename", error: "channel_not_found" }]);
  });

  test("after a confirmed rename, later failures report the new channel name", async () => {
    const stillLive = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: true } }, // rename
      { status: 200, body: { ok: false, error: "not_in_channel" } }, // invite
      { status: 200, body: { ok: true, channel: { is_archived: false } } }, // conversations.info: open
      { status: 200, body: { ok: false, error: "missing_scope" } }, // conversations.join fails
    ]);
    const db = makeDb([
      { data: [{ id: "e1", name: "Renamed", ends_at: stillLive, slack_channel_id: "C1", slack_channel_name: "e-old" }] },
      { error: null }, // persist rename
      { data: [{ event_id: "e1", person_id: "p1", person: { slack_user_id: "U1" } }] },
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.failures).toEqual([{ event: "Renamed", channel: "e-renamed", op: "invite", error: "join:missing_scope" }]);
  });

  test("re-running archives nothing new (idempotent — already-channeled+archived events aren't reloaded)", async () => {
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([
      { data: [] }, // no events match slack_channel_id not null AND slack_archived_at null
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.archived).toBe(0);
    expect(requests).toHaveLength(0);
  });

  test("rename-reconciles a surviving event whose stored name matches neither candidate", async () => {
    const stillLive = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: true } }, // conversations.rename
    ]);
    const db = makeDb([
      { data: [{ id: "e1", name: "Renamed In Gcal", ends_at: stillLive, slack_channel_id: "C1", slack_channel_name: "e-old-title" }] },
      { error: null }, // persist new slack_channel_name
      { data: [] }, // signup sweep
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.renamed).toBe(1);
  });

  test("retries a null-invited linked signup", async () => {
    const stillLive = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true } }, // conversations.invite
    ]);
    const db = makeDb([
      { data: [{ id: "e1", name: "Kickoff", ends_at: stillLive, slack_channel_id: "C1", slack_channel_name: "e-kickoff" }] }, // events (matches base, no rename)
      { data: [{ event_id: "e1", person_id: "p1", person: { slack_user_id: "U1" } }] }, // uninvited signups
      { error: null }, // persist slack_invited_at
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.invited).toBe(1);
    expect(requests[0].url).toContain("conversations.invite");
  });

  describe("invite self-heal (not_in_channel)", () => {
    const stillLive = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = () => ({ id: "e1", name: "Kickoff", ends_at: stillLive(), slack_channel_id: "C1", slack_channel_name: "e-kickoff" });
    const signup = (p: string) => ({ event_id: "e1", person_id: p, person: { slack_user_id: `U-${p}` } });
    const notIn = { status: 200, body: { ok: false, error: "not_in_channel" } };
    const open = { status: 200, body: { ok: true, channel: { is_archived: false } } };
    const methods = (requests: CapturedRequest[]) => requests.map((r) => r.url.split("/api/")[1].split("?")[0]);

    test("joins, retries the invite once, and records the invite", async () => {
      const { fetchFn, requests } = fakeFetch([notIn, open, { status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }]);
      const db = makeDb([{ data: [ev()] }, { data: [signup("p1")] }, { error: null }]);
      const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
      expect(methods(requests)).toEqual(["conversations.invite", "conversations.info", "conversations.join", "conversations.invite"]);
      expect(result.invited).toBe(1);
      expect(result.failed).toBe(0);
      expect(db.updates).toHaveLength(1);
    });

    test("join failure records join:<code>; many signups still join only once", async () => {
      const { fetchFn, requests } = fakeFetch([notIn, open, { status: 200, body: { ok: false, error: "missing_scope" } }, notIn, notIn]);
      const db = makeDb([{ data: [ev()] }, { data: [signup("p1"), signup("p2"), signup("p3")] }]);
      const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
      expect(methods(requests).filter((m) => m === "conversations.join")).toHaveLength(1);
      expect(methods(requests).filter((m) => m === "conversations.info")).toHaveLength(1);
      expect(result.invited).toBe(0);
      expect(result.failures).toHaveLength(3);
      expect(result.failures.every((f) => f.op === "invite" && f.error === "join:missing_scope")).toBe(true);
    });

    test("join says is_archived: stamps archived and skips the remaining invites", async () => {
      const { fetchFn, requests } = fakeFetch([notIn, open, { status: 200, body: { ok: false, error: "is_archived" } }]);
      const db = makeDb([{ data: [ev()] }, { data: [signup("p1"), signup("p2")] }, { error: null }]);
      const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
      expect(result.archived).toBe(1);
      expect(result.failed).toBe(0);
      expect(requests).toHaveLength(3);
      expect(db.updates).toEqual([{ slack_archived_at: expect.any(String) }]);
    });

    test("multiple signups: one join, every signup invited", async () => {
      const { fetchFn, requests } = fakeFetch([
        notIn,
        open,
        { status: 200, body: { ok: true } }, // join
        { status: 200, body: { ok: true } }, // retry p1
        { status: 200, body: { ok: true } }, // invite p2 (normal)
        { status: 200, body: { ok: true } }, // invite p3 (normal)
      ]);
      const db = makeDb([{ data: [ev()] }, { data: [signup("p1"), signup("p2"), signup("p3")] }, { error: null }, { error: null }, { error: null }]);
      const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
      expect(methods(requests).filter((m) => m === "conversations.join")).toHaveLength(1);
      expect(methods(requests).filter((m) => m === "conversations.invite")).toHaveLength(4);
      expect(result.invited).toBe(3);
      expect(result.failed).toBe(0);
    });

    test("info lookup error: no join, fails with info context", async () => {
      const { fetchFn, requests } = fakeFetch([notIn, { status: 200, body: { ok: false, error: "missing_scope" } }]);
      const db = makeDb([{ data: [ev()] }, { data: [signup("p1")] }]);
      const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
      expect(methods(requests)).not.toContain("conversations.join");
      expect(result.failures).toEqual([{ event: "Kickoff", channel: "e-kickoff", op: "invite", error: "not_in_channel (info: missing_scope)" }]);
    });

    test("retry failure after a good join is recorded as an invite failure", async () => {
      const { fetchFn } = fakeFetch([notIn, open, { status: 200, body: { ok: true } }, { status: 200, body: { ok: false, error: "user_not_found" } }]);
      const db = makeDb([{ data: [ev()] }, { data: [signup("p1")] }]);
      const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
      expect(result.failures).toEqual([{ event: "Kickoff", channel: "e-kickoff", op: "invite", error: "user_not_found" }]);
    });
  });

  test("still-unlinked signup is skipped, no invite call", async () => {
    const stillLive = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn, requests } = fakeFetch();
    const db = makeDb([
      { data: [{ id: "e1", name: "Kickoff", ends_at: stillLive, slack_channel_id: "C1", slack_channel_name: "e-kickoff" }] },
      { data: [{ event_id: "e1", person_id: "p1", person: { slack_user_id: null } }] },
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.invited).toBe(0);
    expect(requests).toHaveLength(0);
  });
});

describe("isChannelArchived", () => {
  test("no token / non-prod: false, no request", async () => {
    const { fetchFn, requests } = fakeFetch();
    expect(await isChannelArchived(devDeps(fetchFn), "C1")).toEqual({ archived: false });
    expect(await isChannelArchived({ fetch: fetchFn, token: "", isProd: true }, "C1")).toEqual({ archived: false });
    expect(requests).toHaveLength(0);
  });

  test("GETs conversations.info with the channel as a query param", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true, channel: { is_archived: true } } }]);
    expect(await isChannelArchived(prodDeps(fetchFn), "C1")).toEqual({ archived: true });
    expect(requests[0].url).toBe("https://slack.com/api/conversations.info?channel=C1");
    expect(requests[0].init?.method).toBe("GET");
  });

  test("Slack error is carried, never throws", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { ok: false, error: "missing_scope" } }]);
    expect(await isChannelArchived(prodDeps(fetchFn), "C1")).toEqual({ archived: false, error: "missing_scope" });
    const boom = (async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    expect(await isChannelArchived(prodDeps(boom), "C1")).toEqual({ archived: false, error: "boom" });
  });
});

describe("sweepEventChannels: out-of-band archive detection", () => {
  const noSleep = { sleep: async () => {} };
  const oldEnded = () => new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const stillLive = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  test("archive restricted_action on an archived channel is recorded as archived, no failure", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "restricted_action" } },
      { status: 200, body: { ok: true, channel: { is_archived: true } } },
    ]);
    const db = makeDb([
      { data: [{ id: "e-old", name: "Old", ends_at: oldEnded(), slack_channel_id: "C-OLD", slack_channel_name: "e-old" }] },
      { error: null }, // persist archived_at
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.archived).toBe(1);
    expect(result.failed).toBe(0);
    expect(requests[1].url).toContain("conversations.info");
    expect(db.calls).toEqual(["event", "event"]);
    expect(db.updates).toEqual([{ slack_archived_at: expect.any(String) }]);
  });

  test("archive restricted_action on an open channel stays a failure", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: false, error: "restricted_action" } },
      { status: 200, body: { ok: true, channel: { is_archived: false } } },
    ]);
    const db = makeDb([{ data: [{ id: "e-old", name: "Old", ends_at: oldEnded(), slack_channel_id: "C-OLD", slack_channel_name: "e-old" }] }]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.archived).toBe(0);
    expect(result.failures).toEqual([{ event: "Old", channel: "e-old", op: "archive", error: "restricted_action" }]);
  });

  test("info lookup failure keeps the original archive error with context", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: false, error: "restricted_action" } },
      { status: 200, body: { ok: false, error: "missing_scope" } },
    ]);
    const db = makeDb([{ data: [{ id: "e-old", name: "Old", ends_at: oldEnded(), slack_channel_id: "C-OLD", slack_channel_name: "e-old" }] }]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.failures).toEqual([{ event: "Old", channel: "e-old", op: "archive", error: "restricted_action (info: missing_scope)" }]);
  });

  test("invite not_in_channel on an archived channel stamps archived_at and skips that event's remaining invites", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "not_in_channel" } }, // invite #1
      { status: 200, body: { ok: true, channel: { is_archived: true } } }, // info
    ]);
    const db = makeDb([
      { data: [{ id: "e1", name: "Kickoff", ends_at: stillLive(), slack_channel_id: "C1", slack_channel_name: "e-kickoff" }] },
      {
        data: [
          { event_id: "e1", person_id: "p1", person: { slack_user_id: "U1" } },
          { event_id: "e1", person_id: "p2", person: { slack_user_id: "U2" } },
        ],
      },
      { error: null }, // persist archived_at
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.archived).toBe(1);
    expect(result.invited).toBe(0);
    expect(result.failed).toBe(0);
    expect(requests.map((r) => r.url.split("/api/")[1].split("?")[0])).toEqual(["conversations.invite", "conversations.info"]);
    expect(db.updates).toEqual([{ slack_archived_at: expect.any(String) }]);
  });

  test("invite is_archived on an open channel stays a failure; info checked once per event", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "is_archived" } },
      { status: 200, body: { ok: true, channel: { is_archived: false } } }, // info (cached)
      { status: 200, body: { ok: false, error: "is_archived" } },
    ]);
    const db = makeDb([
      { data: [{ id: "e1", name: "Kickoff", ends_at: stillLive(), slack_channel_id: "C1", slack_channel_name: "e-kickoff" }] },
      {
        data: [
          { event_id: "e1", person_id: "p1", person: { slack_user_id: "U1" } },
          { event_id: "e1", person_id: "p2", person: { slack_user_id: "U2" } },
        ],
      },
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), ...noSleep });
    expect(result.failed).toBe(2);
    expect(result.failures.every((f) => f.error === "is_archived")).toBe(true);
    expect(requests.filter((r) => r.url.includes("conversations.info"))).toHaveLength(1);
  });
});

describe("sweepEventChannels: interleaved signups across events", () => {
  test("an archived event's later signups are skipped while other events keep inviting", async () => {
    const live = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "not_in_channel" } }, // e1 invite
      { status: 200, body: { ok: true, channel: { is_archived: true } } }, // e1 info
      { status: 200, body: { ok: true } }, // e2 invite
    ]);
    const db = makeDb([
      {
        data: [
          { id: "e1", name: "One", ends_at: live, slack_channel_id: "C1", slack_channel_name: "e-one" },
          { id: "e2", name: "Two", ends_at: live, slack_channel_id: "C2", slack_channel_name: "e-two" },
        ],
      },
      {
        data: [
          { event_id: "e1", person_id: "p1", person: { slack_user_id: "U1" } },
          { event_id: "e2", person_id: "p2", person: { slack_user_id: "U2" } },
          { event_id: "e1", person_id: "p3", person: { slack_user_id: "U3" } },
        ],
      },
      { error: null }, // e1 archived_at
      { error: null }, // e2 slack_invited_at
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), sleep: async () => {} });
    expect(result).toMatchObject({ archived: 1, invited: 1, failed: 0 });
    expect(requests.map((r) => r.url.split("/api/")[1].split("?")[0])).toEqual(["conversations.invite", "conversations.info", "conversations.invite"]);
    expect(db.updates).toEqual([{ slack_archived_at: expect.any(String) }, { slack_invited_at: expect.any(String) }]);
  });

  // Routes fake Slack responses by method + channel so interleaved events are deterministic.
  function routedFetch(handler: (method: string, channel: string) => unknown) {
    const requests: { method: string; channel: string }[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = String(url).split("/api/")[1].split("?")[0];
      const channel = method === "conversations.info" ? new URL(String(url)).searchParams.get("channel")! : (JSON.parse(init!.body as string).channel as string);
      requests.push({ method, channel });
      const out = handler(method, channel);
      if (out instanceof Error) throw out;
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;
    return { fetchFn, requests };
  }
  const liveEv = (id: string, ch: string) => ({ id, name: id, ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), slack_channel_id: ch, slack_channel_name: `e-${id}` });
  const su = (e: string, p: string) => ({ event_id: e, person_id: p, person: { slack_user_id: `U-${p}` } });

  test("a join fetch that rejects is recorded as join:threw; sweep completes and later events still invite", async () => {
    const { fetchFn, requests } = routedFetch((m, c) => {
      if (m === "conversations.info") return { ok: true, channel: { is_archived: false } };
      if (m === "conversations.join") return new Error("network down");
      return c === "C1" ? { ok: false, error: "not_in_channel" } : { ok: true };
    });
    const db = makeDb([{ data: [liveEv("e1", "C1"), liveEv("e2", "C2")] }, { data: [su("e1", "p1"), su("e2", "p2")] }, { error: null }]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), sleep: async () => {} });
    expect(result.failures).toEqual([{ event: "e1", channel: "e-e1", op: "invite", error: "join:threw" }]);
    expect(result.invited).toBe(1);
    expect(requests.filter((r) => r.method === "conversations.join")).toHaveLength(1);
  });

  test("per-event join cache does not leak: A's failed join and B's good join stay independent", async () => {
    const { fetchFn, requests } = routedFetch((m, c) => {
      if (m === "conversations.info") return { ok: true, channel: { is_archived: false } };
      if (m === "conversations.join") return c === "C1" ? { ok: false, error: "missing_scope" } : { ok: true };
      // C2 is only invitable after joining; C1 never is.
      if (c === "C1") return { ok: false, error: "not_in_channel" };
      const joined = requests.some((r) => r.method === "conversations.join" && r.channel === "C2");
      return joined ? { ok: true } : { ok: false, error: "not_in_channel" };
    });
    const db = makeDb([
      { data: [liveEv("e1", "C1"), liveEv("e2", "C2")] },
      { data: [su("e1", "p1"), su("e2", "p2"), su("e1", "p3"), su("e2", "p4")] },
      { error: null },
      { error: null },
    ]);
    const result = await sweepEventChannels({ db: db as never, slack: fakeSlackDeps(fetchFn), sleep: async () => {} });
    expect(requests.filter((r) => r.method === "conversations.join").map((r) => r.channel).sort()).toEqual(["C1", "C2"]);
    expect(result.invited).toBe(2);
    expect(result.failures).toEqual([
      { event: "e1", channel: "e-e1", op: "invite", error: "join:missing_scope" },
      { event: "e1", channel: "e-e1", op: "invite", error: "join:missing_scope" },
    ]);
  });
});
