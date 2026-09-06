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
      // `current` starts as the canned result; `.in()` narrows `current.data` when the rows
      // carry the filtered column, so later `.then`/`.maybeSingle` see the filtered rows.
      let current = result;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not"]) {
        chain[m] = () => chain;
      }
      chain.in = (column: string, ids: readonly unknown[]) => {
        const rows = current.data;
        if (Array.isArray(rows) && rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], column)) {
          current = { ...current, data: rows.filter((row) => ids.includes((row as Record<string, unknown>)[column])) };
        }
        return chain;
      };
      chain.maybeSingle = async () => current;
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
      chain.then = (onF: (v: unknown) => unknown) => onF(current);
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
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
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
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
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
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
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
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
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
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
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

  test("github_sync_allow_inactive: true keeps an inactive member expected and PUTs them", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: true }], error: null },
      team_membership: {
        data: [
          { person: { id: "p1", first_name: "Al", last_name: "Um", is_active: false, github_login: "alum", github_user_id: 1 } },
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
        return new Response(JSON.stringify({ role: "member", state: "active" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    const report = result.teams[0];
    expect(report.added).toEqual(["alum"]);
    expect(report.wouldRemove).toEqual([]);
  });

  test("github_sync_allow_inactive: false (default) excludes an inactive member from expected", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
      team_membership: {
        data: [
          { person: { id: "p1", first_name: "Al", last_name: "Um", is_active: false, github_login: "alum", github_user_id: 1 } },
        ],
        error: null,
      },
    });

    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      // Inactive member is already on the GitHub team; since they're not expected, they land in wouldRemove.
      if (u.includes("/members?")) return new Response(JSON.stringify([{ id: 1, login: "alum" }]), { status: 200 });
      if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    const report = result.teams[0];
    expect(report.expectedCount).toBe(0);
    expect(report.wouldRemove).toEqual([{ id: 1, login: "alum" }]);
  });

  test("unions github external accounts into expected, ignores google rows, and doesn't add them to notConnected", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
      team_membership: { data: [], error: null },
      team_external_account: {
        data: [
          { provider: "github", identifier: "bot-login", github_user_id: 42 },
          { provider: "google", identifier: "ignored@x.com", github_user_id: null },
        ],
        error: null,
      },
    });

    const calls: { method: string | undefined; url: string }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      calls.push({ method: init?.method, url: u });
      if (u.includes("/members?")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/memberships/") && init?.method === "PUT") {
        return new Response(JSON.stringify({ role: "member", state: "active" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    const report = result.teams[0];
    expect(report.expectedCount).toBe(1); // google row excluded
    expect(report.added).toEqual(["bot-login"]);
    expect(report.notConnected).toEqual([]);
  });

  test("a github external account already on the team is not in wouldRemove and does not surface via computeGithubAddRecommendations", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
      team_membership: { data: [], error: null },
      team_external_account: {
        data: [{ provider: "github", identifier: "bot-login", github_user_id: 42 }],
        error: null,
      },
    });

    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      if (u.includes("/members?")) return new Response(JSON.stringify([{ id: 42, login: "bot-login" }]), { status: 200 });
      if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    const report = result.teams[0];
    expect(report.wouldRemove).toEqual([]);

    const s2t = new Map([["software", { teamId: "t1", teamName: "Team A", allowInactive: false }]]);
    const people = new Map([[42, { personId: "px", name: "Bot", isActive: true }]]);
    expect(computeGithubAddRecommendations(result, s2t, people, new Map())).toEqual([]);
  });

  test("an external-account read error is pushed to report.errors and the team is skipped", async () => {
    const db = fakeDb({
      team: { data: [{ id: "t1", name: "Team A", github_team_slug: "software", github_sync_allow_inactive: false }], error: null },
      team_membership: { data: [], error: null },
      team_external_account: { data: null, error: { message: "boom" } },
    });

    const fetchFn = vi.fn(async () => {
      throw new Error("should not be called");
    });

    const result = await reconcileGithubTeams({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    expect(result.teams[0].errors).toEqual(["boom"]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  describe("umbrella (subtree) expected sets", () => {
    // Tree: FRC (t1, slug "frc") is parent of FRC Students (t2, slug "frc-students").
    const tree = [
      { id: "t1", name: "FRC", parent_team_id: null, github_team_slug: "frc", github_sync_allow_inactive: false },
      { id: "t2", name: "FRC Students", parent_team_id: "t1", github_team_slug: "frc-students", github_sync_allow_inactive: false },
    ];

    test("umbrella team's expected/added include a descendant's members and external account; descendant's report has only its own", async () => {
      const db = fakeDb({
        team: { data: tree, error: null },
        team_membership: {
          data: [
            { team_id: "t2", person: { id: "p1", first_name: "Stu", last_name: "Dent", is_active: true, github_login: "stu", github_user_id: 1 } },
          ],
          error: null,
        },
        team_external_account: {
          data: [{ team_id: "t2", provider: "github", identifier: "bot-login", github_user_id: 42 }],
          error: null,
        },
      });

      const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("access_tokens")) return tokenResponse();
        if (u.includes("/members?")) return new Response(JSON.stringify([]), { status: 200 });
        if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
        if (u.includes("/memberships/") && init?.method === "PUT") {
          return new Response(JSON.stringify({ role: "member", state: "active" }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${u} ${init?.method}`);
      });

      const result = await reconcileGithubTeams({
        db: db as never,
        fetch: fetchFn as unknown as typeof globalThis.fetch,
        credentials,
      });

      expect(result.teams).toHaveLength(2);
      const frc = result.teams.find((t) => t.teamSlug === "frc")!;
      const frcStudents = result.teams.find((t) => t.teamSlug === "frc-students")!;

      expect(frc.expectedCount).toBe(2); // student + bot, from the descendant
      expect(frc.added.sort()).toEqual(["bot-login", "stu"]);

      expect(frcStudents.expectedCount).toBe(2); // its own member + its own external account
      expect(frcStudents.added.sort()).toEqual(["bot-login", "stu"]);
    });

    test("a person who is a direct member of both parent and child is counted once and PUT once", async () => {
      const db = fakeDb({
        team: { data: tree, error: null },
        team_membership: {
          data: [
            { team_id: "t1", person: { id: "p1", first_name: "Both", last_name: "Places", is_active: true, github_login: "both", github_user_id: 7 } },
            { team_id: "t2", person: { id: "p1", first_name: "Both", last_name: "Places", is_active: true, github_login: "both", github_user_id: 7 } },
          ],
          error: null,
        },
      });

      const puts: string[] = [];
      const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("access_tokens")) return tokenResponse();
        if (u.includes("/members?")) return new Response(JSON.stringify([]), { status: 200 });
        if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
        if (u.includes("/memberships/") && init?.method === "PUT") {
          puts.push(u);
          return new Response(JSON.stringify({ role: "member", state: "active" }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${u} ${init?.method}`);
      });

      const result = await reconcileGithubTeams({
        db: db as never,
        fetch: fetchFn as unknown as typeof globalThis.fetch,
        credentials,
      });

      const frc = result.teams.find((t) => t.teamSlug === "frc")!;
      expect(frc.expectedCount).toBe(1);
      expect(frc.added).toEqual(["both"]);
      expect(puts.filter((u) => u.includes("/teams/frc/"))).toHaveLength(1);
    });

    test("an inactive member of a child is in the parent's expected set iff the parent's github_sync_allow_inactive is true", async () => {
      const membershipRow = {
        team_id: "t2",
        person: { id: "p1", first_name: "In", last_name: "Active", is_active: false, github_login: "inactive", github_user_id: 3 },
      };

      const fetchFnFor = () =>
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.includes("access_tokens")) return tokenResponse();
          if (u.includes("/members?")) return new Response(JSON.stringify([]), { status: 200 });
          if (u.includes("/invitations")) return new Response(JSON.stringify([]), { status: 200 });
          if (u.includes("/memberships/") && init?.method === "PUT") {
            return new Response(JSON.stringify({ role: "member", state: "active" }), { status: 200 });
          }
          throw new Error(`unexpected fetch: ${u} ${init?.method}`);
        });

      // Parent's flag true: inactive descendant member is expected.
      const allowInactiveTree = tree.map((t) => (t.id === "t1" ? { ...t, github_sync_allow_inactive: true } : t));
      const dbAllow = fakeDb({
        team: { data: allowInactiveTree, error: null },
        team_membership: { data: [membershipRow], error: null },
      });
      const resultAllow = await reconcileGithubTeams({
        db: dbAllow as never,
        fetch: fetchFnFor() as unknown as typeof globalThis.fetch,
        credentials,
      });
      const frcAllow = resultAllow.teams.find((t) => t.teamSlug === "frc")!;
      expect(frcAllow.expectedCount).toBe(1);
      expect(frcAllow.added).toEqual(["inactive"]);

      // Parent's flag false (default): inactive descendant member is excluded.
      const dbDeny = fakeDb({
        team: { data: tree, error: null },
        team_membership: { data: [membershipRow], error: null },
      });
      const resultDeny = await reconcileGithubTeams({
        db: dbDeny as never,
        fetch: fetchFnFor() as unknown as typeof globalThis.fetch,
        credentials,
      });
      const frcDeny = resultDeny.teams.find((t) => t.teamSlug === "frc")!;
      expect(frcDeny.expectedCount).toBe(0);
      expect(frcDeny.added).toEqual([]);
    });

    test("a cyclic tree (A<->B) still produces one report per linked team and terminates", async () => {
      const cyclicTree = [
        { id: "a", name: "A", parent_team_id: "b", github_team_slug: "team-a", github_sync_allow_inactive: false },
        { id: "b", name: "B", parent_team_id: "a", github_team_slug: "team-b", github_sync_allow_inactive: false },
      ];
      const db = fakeDb({
        team: { data: cyclicTree, error: null },
        team_membership: { data: [], error: null },
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

      expect(result.teams).toHaveLength(2);
      expect(result.teams.map((t) => t.teamSlug).sort()).toEqual(["team-a", "team-b"]);
    });

    test("a team-tree read error makes reconcile throw and makes no external calls", async () => {
      const db = fakeDb({
        team: { data: null, error: { message: "tree boom" } },
      });
      const fetchFn = vi.fn(async () => {
        throw new Error("should not be called");
      });

      await expect(
        reconcileGithubTeams({ db: db as never, fetch: fetchFn as unknown as typeof globalThis.fetch, credentials }),
      ).rejects.toThrow();
      expect(fetchFn).not.toHaveBeenCalled();
    });
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

  test("member of a child whose parent is linked PUTs onto the parent's slug", async () => {
    const db = fakeDb({
      person: { data: { github_login: "alice" }, error: null },
      team_membership: { data: [{ team: { id: "c1", github_team_slug: null } }], error: null },
      team: {
        data: [
          { id: "p1", parent_team_id: null, github_team_slug: "frc" },
          { id: "c1", parent_team_id: "p1", github_team_slug: null },
        ],
        error: null,
      },
    });
    const puts: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      if (u.includes("/memberships/") && init?.method === "PUT") puts.push(u);
      return new Response(JSON.stringify({ state: "active" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await syncPersonLinkedTeams("p1", db as never);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toContain("/teams/frc/");
  });

  test("member of a child whose parent is also linked PUTs onto both slugs", async () => {
    const db = fakeDb({
      person: { data: { github_login: "alice" }, error: null },
      team_membership: { data: [{ team: { id: "c1", github_team_slug: "frc-students" } }], error: null },
      team: {
        data: [
          { id: "p1", parent_team_id: null, github_team_slug: "frc" },
          { id: "c1", parent_team_id: "p1", github_team_slug: "frc-students" },
        ],
        error: null,
      },
    });
    const puts: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      if (u.includes("/memberships/") && init?.method === "PUT") puts.push(u);
      return new Response(JSON.stringify({ state: "active" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await syncPersonLinkedTeams("p1", db as never);
    expect(puts).toHaveLength(2);
    expect(puts.some((u) => u.includes("/teams/frc/"))).toBe(true);
    expect(puts.some((u) => u.includes("/teams/frc-students/"))).toBe(true);
  });

  test("the same ancestor slug reachable via two member teams is PUT only once", async () => {
    const db = fakeDb({
      person: { data: { github_login: "alice" }, error: null },
      team_membership: {
        data: [
          { team: { id: "c1", github_team_slug: null } },
          { team: { id: "c2", github_team_slug: null } },
        ],
        error: null,
      },
      team: {
        data: [
          { id: "p1", parent_team_id: null, github_team_slug: "frc" },
          { id: "c1", parent_team_id: "p1", github_team_slug: null },
          { id: "c2", parent_team_id: "p1", github_team_slug: null },
        ],
        error: null,
      },
    });
    const puts: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("access_tokens")) return tokenResponse();
      if (u.includes("/memberships/") && init?.method === "PUT") puts.push(u);
      return new Response(JSON.stringify({ state: "active" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await syncPersonLinkedTeams("p1", db as never);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toContain("/teams/frc/");
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
  const s2t = new Map([["software", { teamId: "t1", teamName: "Team A", allowInactive: false }]]);

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

  test("recommends an inactive person when the team allows inactive members", () => {
    const s2tAllow = new Map([["software", { teamId: "t1", teamName: "Team A", allowInactive: true }]]);
    const r = report([{ teamSlug: "software", wouldRemove: [{ id: 2, login: "old" }] }]);
    const people = new Map([[2, { personId: "p2", name: "Old", isActive: false }]]);
    expect(computeGithubAddRecommendations(r, s2tAllow, people, new Map())).toEqual([
      { teamId: "t1", teamName: "Team A", teamSlug: "software",
        people: [{ personId: "p2", name: "Old", labels: ["@old"] }] },
    ]);
  });

  test("does not recommend an inactive person when the team disallows inactive members", () => {
    const r = report([{ teamSlug: "software", wouldRemove: [{ id: 2, login: "old" }] }]);
    const people = new Map([[2, { personId: "p2", name: "Old", isActive: false }]]);
    expect(computeGithubAddRecommendations(r, s2t, people, new Map())).toEqual([]);
  });
});
