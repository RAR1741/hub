import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  computeGroupDiff,
  reconcileDriveGroups,
  syncMembershipChange,
} from "./drive-group-sync";
import type { DirectoryCredentials } from "./google-directory";

const { privateKey: rawKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = rawKey.export({ type: "pkcs8", format: "pem" }).toString();

const credentials: DirectoryCredentials = {
  clientEmail: "sa@example.iam.gserviceaccount.com",
  privateKey: PEM,
  adminSubject: "admin@example.org",
};

// Generic chained-query stub in the style of attendance.test.ts / sessions.test.ts.
function fakeDb(tables: Record<string, { data: unknown; error: unknown }>, upserts: unknown[] = []) {
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
      chain.then = (onF: (v: unknown) => unknown) => onF(result);
      return chain;
    },
  } as never;
}

function fakeFetchToken() {
  // Any call to the token endpoint (accounts.google.com) returns an access token.
  return vi.fn(async (url: string) => {
    if (String(url).includes("oauth2")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("computeGroupDiff", () => {
  test("case-insensitive comparison", () => {
    expect(computeGroupDiff(["A@X.com"], ["a@x.com"])).toEqual({ missing: [], extra: [] });
  });
  test("dedupes both sides", () => {
    expect(computeGroupDiff(["a@x.com", "a@x.com"], ["a@x.com"])).toEqual({ missing: [], extra: [] });
  });
  test("both empty", () => {
    expect(computeGroupDiff([], [])).toEqual({ missing: [], extra: [] });
  });
  test("finds missing and extra", () => {
    expect(computeGroupDiff(["a@x.com", "b@x.com"], ["b@x.com", "c@x.com"])).toEqual({
      missing: ["a@x.com"],
      extra: ["c@x.com"],
    });
  });
});

describe("reconcileDriveGroups", () => {
  test("adds exactly the missing member, records wouldRemove without deleting, persists drive_last_reconcile", async () => {
    const upserts: unknown[] = [];
    const db = fakeDb(
      {
        team: {
          data: [{ id: "t1", name: "Team A", google_group_email: "team-a@example.org" }],
          error: null,
        },
        team_membership: {
          data: [
            { person: { email: "keep@x.com", is_active: true } },
            { person: { email: "inactive@x.com", is_active: false } },
            { person: { email: null, is_active: true } },
          ],
          error: null,
        },
      },
      upserts,
    );

    const calls: { method: string | undefined; url: string }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      calls.push({ method: init?.method, url: u });
      if (u.includes("/members") && !init?.method) {
        return new Response(JSON.stringify({ members: [{ email: "extra@x.com" }] }), { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u} ${init?.method}`);
    });

    const result = await reconcileDriveGroups({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
      now: () => new Date("2026-08-15T10:00:00Z").getTime(),
    });

    expect(result.groups).toHaveLength(1);
    const g = result.groups[0];
    expect(g.teamName).toBe("Team A");
    expect(g.groupEmail).toBe("team-a@example.org");
    expect(g.expectedCount).toBe(1);
    expect(g.actualCount).toBe(1);
    expect(g.added).toEqual(["keep@x.com"]);
    expect(g.wouldRemove).toEqual(["extra@x.com"]);
    expect(g.errors).toEqual([]);

    // No delete call was ever made.
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    // One insert call for the missing member.
    expect(calls.some((c) => c.method === "POST")).toBe(true);

    // Persisted.
    expect(upserts).toHaveLength(1);
    expect((upserts[0] as { table: string }).table).toBe("app_setting");
    expect((upserts[0] as { payload: { key: string } }).payload.key).toBe("drive_last_reconcile");
  });

  test("continues past a failing group", async () => {
    const upserts: unknown[] = [];
    const db = fakeDb(
      {
        team: {
          data: [
            { id: "t1", name: "Team A", google_group_email: "team-a@example.org" },
            { id: "t2", name: "Team B", google_group_email: "team-b@example.org" },
          ],
          error: null,
        },
        team_membership: {
          data: [{ person: { email: "keep@x.com", is_active: true } }],
          error: null,
        },
      },
      upserts,
    );

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      if (u.includes("team-a")) {
        throw new Error("network down");
      }
      if (u.includes("/members")) {
        return new Response(JSON.stringify({ members: [] }), { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const result = await reconcileDriveGroups({
      db: db as never,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      credentials,
    });

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].errors.length).toBeGreaterThan(0);
    expect(result.groups[1].errors).toEqual([]);
    expect(result.groups[1].added).toEqual(["keep@x.com"]);
  });
});

describe("syncMembershipChange", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_SA_CLIENT_EMAIL = "sa@example.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = PEM;
    process.env.GOOGLE_ADMIN_SUBJECT = "admin@example.org";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  test("no-ops when directory credentials are not configured", async () => {
    delete process.env.GOOGLE_SA_CLIENT_EMAIL;
    const db = fakeDb({
      team: { data: { google_group_email: "g@example.org" }, error: null },
      person: { data: { email: "a@x.com", is_active: true }, error: null },
    });
    await expect(syncMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
  });

  test("no-ops when the team has no google_group_email", async () => {
    const db = fakeDb({
      team: { data: { google_group_email: null }, error: null },
      person: { data: { email: "a@x.com", is_active: true }, error: null },
    });
    await expect(syncMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
  });

  test("no-ops when the person has no email", async () => {
    const db = fakeDb({
      team: { data: { google_group_email: "g@example.org" }, error: null },
      person: { data: { email: null, is_active: true }, error: null },
    });
    await expect(syncMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
  });

  test("no-ops when the person is inactive", async () => {
    const db = fakeDb({
      team: { data: { google_group_email: "g@example.org" }, error: null },
      person: { data: { email: "a@x.com", is_active: false }, error: null },
    });
    await expect(syncMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
  });

  test("calls insert on add when configured", async () => {
    const db = fakeDb({
      team: { data: { google_group_email: "g@example.org" }, error: null },
      person: { data: { email: "a@x.com", is_active: true }, error: null },
    });
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      calls.push(init?.method ?? "GET");
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await syncMembershipChange("add", "t1", "p1", db as never);
    expect(calls).toEqual(["POST"]);
  });

  test("calls delete on remove when configured", async () => {
    const db = fakeDb({
      team: { data: { google_group_email: "g@example.org" }, error: null },
      person: { data: { email: "a@x.com", is_active: true }, error: null },
    });
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      calls.push(init?.method ?? "GET");
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await syncMembershipChange("remove", "t1", "p1", db as never);
    expect(calls).toEqual(["DELETE"]);
  });

  test("never throws even when the Google call fails", async () => {
    const db = fakeDb({
      team: { data: { google_group_email: "g@example.org" }, error: null },
      person: { data: { email: "a@x.com", is_active: true }, error: null },
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncMembershipChange("add", "t1", "p1", db as never)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
