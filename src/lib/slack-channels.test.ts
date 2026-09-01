import { describe, expect, test } from "vitest";
import type { SlackDeps } from "./slack";
import {
  channelSlug,
  createEventChannel,
  renameChannel,
  archiveChannel,
  inviteToChannel,
  postToEventChannel,
  afterEventCreated,
  afterEventUpdated,
  afterEventSignup,
  sweepEventChannels,
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
  function chain(result: { data?: unknown; error?: unknown }) {
    const obj: Record<string, unknown> = {
      select: () => obj,
      not: () => obj,
      is: () => obj,
      eq: () => obj,
      in: () => obj,
      update: () => obj,
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
