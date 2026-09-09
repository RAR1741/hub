import { describe, expect, test } from "vitest";
import type { SlackDeps } from "./slack";
import { computeEffectiveSlackMembers, backfillTeamSlack } from "./team-slack-backfill";

type CapturedRequest = { url: string; init?: RequestInit };

/** Order-based fake Slack fetch (mirrors slack-channels.test.ts). */
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

/**
 * Minimal chainable fake db driven by a queued result per `from(table)` call,
 * in call order. Every query-builder method returns itself; the object is
 * thenable so an awaited chain resolves the queued result.
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
      order: () => obj,
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

const noSleep = { sleep: async () => {} };

// person rows as returned by the `person (...)` embed
function person(id: string, first: string, slack: string | null, active = true) {
  return { person: { id, first_name: first, last_name: "X", display_name: null, slack_user_id: slack, is_active: active } };
}

const TREE = [
  { id: "A", parent_team_id: null },
  { id: "B", parent_team_id: "A" },
];

describe("computeEffectiveSlackMembers", () => {
  test("dedupes by person, filters inactive, splits by slack_user_id", async () => {
    const db = makeDb([
      { data: TREE },
      {
        data: [
          person("p1", "Al", "U1"), // has slack
          person("p1", "Al", "U1"), // duplicate across subtree teams
          person("p2", "Be", null), // active, no slack
          person("p3", "In", "U3", false), // inactive -> excluded
        ],
      },
    ]);

    const result = await computeEffectiveSlackMembers(db as never, "A");

    expect(result.effectiveActive).toBe(2); // p1, p2 (p3 inactive, p1 deduped)
    expect(result.withSlack).toEqual([{ personId: "p1", slackUserId: "U1", name: "Al X" }]);
    expect(result.withoutSlackCount).toBe(1); // p2
    expect(db.calls).toEqual(["team", "team_membership"]);
  });

  test("throws when the team tree read errors", async () => {
    const db = makeDb([{ error: { message: "boom" } }]);
    await expect(computeEffectiveSlackMembers(db as never, "A")).rejects.toThrow("list team tree failed: boom");
  });
});

describe("backfillTeamSlack", () => {
  test("invites only the missing members and reports per-channel counts", async () => {
    const db = makeDb([
      { data: TREE },
      { data: [person("p1", "Al", "U1"), person("p2", "Be", "U2"), person("p3", "Cy", null)] },
      { data: [{ slack_channel_id: "C1", label: "frc" }] },
    ]);
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: true, members: ["U1"], response_metadata: { next_cursor: "" } } }, // U1 already in
      { status: 200, body: { ok: true } }, // invite U2
    ]);

    const summary = await backfillTeamSlack({ db: db as never, slack: prodDeps(fetchFn), ...noSleep }, "A");

    expect(summary.slackConfigured).toBe(true);
    expect(summary.effectiveActive).toBe(3);
    expect(summary.withSlackCount).toBe(2);
    expect(summary.withoutSlackCount).toBe(1);
    expect(summary.channels).toEqual([
      { channelId: "C1", label: "frc", invited: 1, alreadyIn: 1, skippedNoSlack: 1, failed: 0 },
    ]);
    // members read (GET) then a single invite (POST) for the missing user
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("conversations.invite");
    expect(JSON.parse((requests[1].init as RequestInit).body as string).users).toBe("U2");
  });

  test("records a failed invite with its error code, never throws", async () => {
    const db = makeDb([
      { data: TREE },
      { data: [person("p1", "Al", "U1"), person("p2", "Be", "U2")] },
      { data: [{ slack_channel_id: "C1", label: null }] },
    ]);
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: true, members: [], response_metadata: { next_cursor: "" } } },
      { status: 200, body: { ok: false, error: "not_in_channel" } }, // invite rejected
    ]);

    const summary = await backfillTeamSlack({ db: db as never, slack: prodDeps(fetchFn), ...noSleep }, "A");

    expect(summary.channels).toEqual([
      { channelId: "C1", label: null, invited: 0, alreadyIn: 0, skippedNoSlack: 0, failed: 2, error: "not_in_channel" },
    ]);
  });

  test("channel membership read fails: invites everyone as fallback, flags unknown split", async () => {
    const db = makeDb([
      { data: TREE },
      { data: [person("p1", "Al", "U1"), person("p2", "Be", "U2")] },
      { data: [{ slack_channel_id: "C1", label: "frc" }] },
    ]);
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { ok: false, error: "channel_not_found" } }, // conversations.members read fails
      { status: 200, body: { ok: true } }, // fallback invite of everyone succeeds
    ]);

    const summary = await backfillTeamSlack({ db: db as never, slack: prodDeps(fetchFn), ...noSleep }, "A");

    expect(summary.channels).toEqual([
      { channelId: "C1", label: "frc", invited: 2, alreadyIn: 0, skippedNoSlack: 0, failed: 0, membersReadFailed: true },
    ]);
    // both the members read and the fallback invite hit Slack
    expect(requests).toHaveLength(2);
    expect(JSON.parse((requests[1].init as RequestInit).body as string).users).toBe("U1,U2");
  });

  test("does not sleep after the final channel", async () => {
    const db = makeDb([
      { data: TREE },
      { data: [person("p1", "Al", "U1")] },
      { data: [{ slack_channel_id: "C1", label: "frc" }] },
    ]);
    const { fetchFn } = fakeFetch([
      { status: 200, body: { ok: true, members: [], response_metadata: { next_cursor: "" } } },
      { status: 200, body: { ok: true } },
    ]);
    let sleeps = 0;
    await backfillTeamSlack(
      { db: db as never, slack: prodDeps(fetchFn), sleep: async () => { sleeps++; } },
      "A",
    );
    expect(sleeps).toBe(0); // single channel -> no inter-channel pacing
  });

  test("slack not configured: no Slack calls, channels reported with zeros", async () => {
    const db = makeDb([
      { data: TREE },
      { data: [person("p1", "Al", "U1"), person("p2", "Be", null)] },
      { data: [{ slack_channel_id: "C1", label: "frc" }] },
    ]);
    const { fetchFn, requests } = fakeFetch();

    const summary = await backfillTeamSlack(
      { db: db as never, slack: { fetch: fetchFn, token: null, isProd: true }, ...noSleep },
      "A",
    );

    expect(summary.slackConfigured).toBe(false);
    expect(requests).toHaveLength(0);
    expect(summary.channels).toEqual([
      { channelId: "C1", label: "frc", invited: 0, alreadyIn: 0, skippedNoSlack: 1, failed: 0 },
    ]);
  });

  test("no linked channels: empty channel list, no Slack calls", async () => {
    const db = makeDb([
      { data: TREE },
      { data: [person("p1", "Al", "U1")] },
      { data: [] },
    ]);
    const { fetchFn, requests } = fakeFetch();

    const summary = await backfillTeamSlack({ db: db as never, slack: prodDeps(fetchFn), ...noSleep }, "A");

    expect(summary.channels).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
