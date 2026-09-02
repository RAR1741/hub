import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  computeGithubTeamDiff,
  computeGithubAddRecommendations,
  reconcileGithubTeams,
  syncGithubMembershipChange,
  syncPersonLinkedTeams,
} from "./github-team-sync";
import type { GithubAppCredentials } from "./github-app";
import type { GithubReconcileResult } from "./github-team-sync";

const { privateKey: rawKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = rawKey.export({ type: "pkcs8", format: "pem" }).toString();

const credentials: GithubAppCredentials = {
  appId: "123",
  privateKey: PEM,
  installationId: "456",
  org: "RAR1741",
  clientId: "cid",
  clientSecret: "csecret",
};

// Generic chained-query stub in the style of drive-group-sync.test.ts.
function fakeDb(tables: Record<string, { data: unknown; error: unknown }>, upserts: unknown[] = [], updates: unknown[] = []) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not"]) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = async () => result;
      chain.upsert = async (payload: unknown) => {
        upserts.push({ table, payload });
        return { data: null, error: null };
      };
      chain.update = (payload: unknown) => {
        const updateChain: Record<string, unknown> = {};
        updateChain.eq = async (col: string, val: unknown) => {
          updates.push({ table, payload, col, val });
          return { data: null, error: null };
        };
        return updateChain;
      };
      chain.then = (onF: (v: unknown) => unknown) => onF(result);
      return chain;
    },
  } as never;
}

function tokenResponse() {
  return new Response(JSON.stringify({ token: "install-tok" }), { status: 200 });
}

describe("computeGithubTeamDiff", () => {
  test("keys membership on numeric id, not login", () => {
    const expected = [{ id: 1, login: "alice" }];
    const actual = [{ id: 1, login: "alice-renamed" }];
    expect(computeGithubTeamDiff(expected, actual, [])).toEqual({ missing: [], pending: [], extra: [] });
  });

  test("buckets pending expected members by login, not id", () => {
    const expected = [{ id: 1, login: "alice" }, { id: 2, login: "bob" }];
    const actual: { id: number; login: string }[] = [];
    const result = computeGithubTeamDiff(expected, actual, ["ALICE"]);
    expect(result.pending).toEqual(["alice"]);
    expect(result.missing).toEqual([{ id: 2, login: "bob" }]);
  });

  test("extra = actual ids not in expected", () => {
    const expected = [{ id: 1, login: "alice" }];
    const actual = [{ id: 1, login: "alice" }, { id: 9, login: "ghost" }];
    expect(computeGithubTeamDiff(expected, actual, [])).toEqual({
      missing: [],
      pending: [],
      extra: [{ id: 9, login: "ghost" }],
    });
  });
});

describe("reconcileGithubTeams", () => {
  test("does not PUT a missing member whose login is in pendingLogins", async () => {
    const upserts: unknown[] = [];
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software" }], error: null },
      team_membership: {
        data: [
          { person: { id: "p1", first_name: "A", last_name: "One", is_active: true, github_login: "alice", github_user_id: 1 } },
        ],
        error: null,
      },
    }, upserts);

    const calls: { method: string | undefined; url: string }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      calls.push({ method: init?.method, url: u });
      if (u.includes("/members?")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/invitations")) {
        return new Response(JSON.stringify([{ login: "alice", failed_at: null }]), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
      now: () => new Date("2026-09-01T10:00:00Z"),
    });

    expect(result.teams).toHaveLength(1);
    const report = result.teams[0];
    expect(report.pending).toEqual(["alice"]);
    expect(report.added).toEqual([]);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("a PUT returning state pending lands in pending, not added", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software" }], error: null },
      team_membership: {
        data: [
          { person: { id: "p1", first_name: "A", last_name: "One", is_active: true, github_login: "alice", github_user_id: 1 } },
        ],
        error: null,
      },
    });

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      if (u.includes("/members?")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/memberships/") && init?.method === "PUT") {
        return new Response(JSON.stringify({ role: "member", state: "pending" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    const report = result.teams[0];
    expect(report.pending).toEqual(["alice"]);
    expect(report.added).toEqual([]);
  });

  test("a renamed login (actual id matches expected, login differs) triggers exactly one person.update", async () => {
    const updates: unknown[] = [];
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software" }], error: null },
      team_membership: {
        data: [
          { person: { id: "p1", first_name: "A", last_name: "One", is_active: true, github_login: "old-login", github_user_id: 1 } },
        ],
        error: null,
      },
    }, [], updates);

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      if (u.includes("/members?")) return new Response(JSON.stringify([{ id: 1, login: "new-login" }]), { status: 200 });
      if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    expect(updates).toHaveLength(1);
    expect((updates[0] as { table: string }).table).toBe("person");
    expect((updates[0] as { payload: { github_login: string } }).payload).toEqual({ github_login: "new-login" });
    expect((updates[0] as { val: string }).val).toBe("p1");
  });

  test("extra members are never deleted (no DELETE call) and land in wouldRemove", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software" }], error: null },
      team_membership: { data: [], error: null },
    });

    const calls: { method: string | undefined; url: string }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      calls.push({ method: init?.method, url: u });
      if (u.includes("/members?")) return new Response(JSON.stringify([{ id: 9, login: "ghost" }]), { status: 200 });
      if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    expect(result.teams[0].wouldRemove).toEqual([{ id: 9, login: "ghost" }]);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  test("collects notConnected display names for active members with no github_user_id", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software" }], error: null },
      team_membership: {
        data: [
          { person: { id: "p1", first_name: "Jo", last_name: "Doe", is_active: true, github_login: null, github_user_id: null } },
          { person: { id: "p2", first_name: "In", last_name: "Active", is_active: false, github_login: null, github_user_id: null } },
        ],
        error: null,
      },
    });

    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      if (u.includes("/members?")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    expect(result.teams[0].notConnected).toEqual(["Jo Doe"]);
  });
});

describe("syncGithubMembershipChange", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = PEM;
    process.env.GITHUB_APP_INSTALLATION_ID = "456";
    process.env.GITHUB_ORG = "RAR1741";
    process.env.GITHUB_APP_CLIENT_ID = "cid";
    process.env.GITHUB_APP_CLIENT_SECRET = "csecret";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  test("no-ops (no throw, no fetch) when credentials are not configured", async () => {
    delete process.env.GITHUB_APP_ID;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const db = fakeDb({
      team: { data: { github_team_slug: "software" }, error: null },
      person: { data: { github_login: "alice" }, error: null },
    });
    await expect(syncGithubMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("no-ops when the team has no github_team_slug", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const db = fakeDb({
      team: { data: { github_team_slug: null }, error: null },
      person: { data: { github_login: "alice" }, error: null },
    });
    await expect(syncGithubMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("no-ops when the person has no github_login", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const db = fakeDb({
      team: { data: { github_team_slug: "software" }, error: null },
      person: { data: { github_login: null }, error: null },
    });
    await expect(syncGithubMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("PUTs on add when configured", async () => {
    const db = fakeDb({
      team: { data: { github_team_slug: "software" }, error: null },
      person: { data: { github_login: "alice" }, error: null },
    });
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      calls.push(init?.method ?? "GET");
      return new Response(JSON.stringify({ state: "active" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await syncGithubMembershipChange("add", "t1", "p1", db as never);
    expect(calls).toEqual(["PUT"]);
  });

  test("DELETEs on remove when configured", async () => {
    const db = fakeDb({
      team: { data: { github_team_slug: "software" }, error: null },
      person: { data: { github_login: "alice" }, error: null },
    });
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      calls.push(init?.method ?? "GET");
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await syncGithubMembershipChange("remove", "t1", "p1", db as never);
    expect(calls).toEqual(["DELETE"]);
  });

  test("never throws even when the GitHub call fails", async () => {
    const db = fakeDb({
      team: { data: { github_team_slug: "software" }, error: null },
      person: { data: { github_login: "alice" }, error: null },
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncGithubMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("syncPersonLinkedTeams", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = PEM;
    process.env.GITHUB_APP_INSTALLATION_ID = "456";
    process.env.GITHUB_ORG = "RAR1741";
    process.env.GITHUB_APP_CLIENT_ID = "cid";
    process.env.GITHUB_APP_CLIENT_SECRET = "csecret";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  test("no-ops when the person has no github_login", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const db = fakeDb({ person: { data: { github_login: null }, error: null } });
    await expect(syncPersonLinkedTeams("p1", db as never)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("never throws even when the GitHub call fails", async () => {
    const db = fakeDb({
      person: { data: { github_login: "alice" }, error: null },
      team_membership: { data: [{ team: { id: "t1", github_team_slug: "software" } }], error: null },
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncPersonLinkedTeams("p1", db as never)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("computeGithubAddRecommendations", () => {
  const report = (teams: Partial<GithubReconcileResult["teams"][number]>[]): GithubReconcileResult => ({
    ranAt: "2026-09-01T00:00:00Z",
    teams: teams.map((t) => ({
      teamName: "T", teamSlug: "software", expectedCount: 0, actualCount: 0,
      added: [], pending: [], wouldRemove: [], notConnected: [], errors: [], ...t,
    })),
  });
  const s2t = new Map([["software", { teamId: "t1", teamName: "Team A" }]]);

  test("recommends an active, resolved, non-member person with an @login label", () => {
    const r = report([{ teamSlug: "software", wouldRemove: [{ id: 1, login: "bob" }] }]);
    const people = new Map([[1, { personId: "p1", name: "Bob", isActive: true }]]);
    expect(computeGithubAddRecommendations(r, s2t, people, new Map())).toEqual([
      { teamId: "t1", teamName: "Team A", teamSlug: "software",
        people: [{ personId: "p1", name: "Bob", labels: ["@bob"] }] },
    ]);
  });

  test("skips unresolved ids, inactive people, and current members", () => {
    const r = report([{ teamSlug: "software", wouldRemove: [
      { id: 9, login: "ghost" }, { id: 2, login: "old" }, { id: 3, login: "mem" },
    ] }]);
    const people = new Map([
      [2, { personId: "p2", name: "Old", isActive: false }],
      [3, { personId: "p3", name: "Mem", isActive: true }],
    ]);
    const members = new Map([["t1", new Set(["p3"])]]);
    expect(computeGithubAddRecommendations(r, s2t, people, members)).toEqual([]);
  });

  test("omits teams with no linked team and no recommendations", () => {
    const r = report([{ teamSlug: "unlinked", wouldRemove: [{ id: 1, login: "bob" }] }]);
    const people = new Map([[1, { personId: "p1", name: "Bob", isActive: true }]]);
    expect(computeGithubAddRecommendations(r, s2t, people, new Map())).toEqual([]);
  });
});
