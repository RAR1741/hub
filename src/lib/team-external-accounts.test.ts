import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  addTeamExternalAccount,
  removeTeamExternalAccount,
  type TeamExternalAccountDeps,
} from "./team-external-accounts";
import type { DirectoryCredentials } from "./google-directory";
import type { GithubAppCredentials } from "./github-app";

const { privateKey: rawKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = rawKey.export({ type: "pkcs8", format: "pem" }).toString();

const DIRECTORY_CREDS: DirectoryCredentials = {
  clientEmail: "sa@example.iam.gserviceaccount.com",
  privateKey: PEM,
  adminSubject: "admin@example.org",
};

const GITHUB_CREDS: GithubAppCredentials = {
  appId: "1",
  privateKey: PEM,
  installationId: "1",
  org: "RAR1741",
  clientId: "id",
  clientSecret: "secret",
};

// Minimal chained-query fake, in the style of drive-group-sync.test.ts / identities.test.ts.
function fakeDb(opts: {
  team?: { data: unknown; error?: unknown };
  insertResult?: { error?: { code: string } | null };
  onInsert?: (payload: unknown) => void;
  onDelete?: (match: Record<string, unknown>) => void;
  deleteResult?: { data: { identifier: string }[]; error: null } | { data: null; error: { message: string } };
}) {
  return {
    from(table: string) {
      if (table === "team") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => opts.team ?? { data: null } }) }),
        };
      }
      if (table === "team_external_account") {
        return {
          insert: (payload: unknown) => {
            opts.onInsert?.(payload);
            return Promise.resolve(opts.insertResult ?? { error: null });
          },
          delete: () => ({
            eq: (col1: string, val1: unknown) => ({
              eq: (col2: string, val2: unknown) => ({
                eq: (col3: string, val3: unknown) => ({
                  select: async () => {
                    opts.onDelete?.({ [col1]: val1, [col2]: val2, [col3]: val3 });
                    return opts.deleteResult ?? { data: [{ identifier: val3 }], error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function fakeGithubFetch(handler: (url: string) => Response) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/access_tokens")) {
      return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
    }
    return handler(url);
  }) as unknown as typeof fetch;
}

function baseDeps(overrides: Partial<TeamExternalAccountDeps>): TeamExternalAccountDeps {
  return {
    db: fakeDb({}),
    fetch: vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    directoryCredentials: DIRECTORY_CREDS,
    githubCredentials: GITHUB_CREDS,
    ...overrides,
  };
}

describe("addTeamExternalAccount validation", () => {
  test("empty label is rejected", async () => {
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "google", identifier: "bot@example.org", label: "  " },
      baseDeps({}),
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("label over 80 chars is rejected", async () => {
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "google", identifier: "bot@example.org", label: "x".repeat(81) },
      baseDeps({}),
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("google identifier without @ is rejected", async () => {
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "google", identifier: "notanemail", label: "Bot" },
      baseDeps({}),
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("github login with invalid characters is rejected", async () => {
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "github", identifier: "not_valid!", label: "Bot" },
      baseDeps({}),
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("github login with leading hyphen is rejected", async () => {
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "github", identifier: "-bot", label: "Bot" },
      baseDeps({}),
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("github login with trailing hyphen is rejected", async () => {
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "github", identifier: "bot-", label: "Bot" },
      baseDeps({}),
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });
});

describe("addTeamExternalAccount github lookup", () => {
  test("404 from GitHub returns github_user_not_found", async () => {
    const fetchFn = fakeGithubFetch((url) => {
      expect(url).toBe("https://api.github.com/users/ghostbot");
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    });
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "github", identifier: "ghostbot", label: "Bot" },
      baseDeps({ fetch: fetchFn }),
    );
    expect(result).toEqual({ ok: false, status: 404, reason: "github_user_not_found" });
  });

  test("stores the API's lowercased login and numeric id", async () => {
    const fetchFn = fakeGithubFetch(() =>
      new Response(JSON.stringify({ id: 42, login: "RAR1741Programmer" }), { status: 200 }),
    );
    let inserted: unknown;
    const db = fakeDb({
      team: { data: { github_team_slug: null, google_group_email: null } },
      onInsert: (payload) => (inserted = payload),
    });
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "github", identifier: "RAR1741Programmer", label: "Programming bot" },
      baseDeps({ fetch: fetchFn, db }),
    );
    expect(result.ok).toBe(true);
    expect(inserted).toMatchObject({
      team_id: "t1",
      provider: "github",
      identifier: "rar1741programmer",
      github_user_id: 42,
      label: "Programming bot",
    });
  });
});

describe("addTeamExternalAccount insert", () => {
  test("unique violation (23505) maps to 409", async () => {
    const db = fakeDb({
      team: { data: { github_team_slug: null, google_group_email: null } },
      insertResult: { error: { code: "23505" } },
    });
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "google", identifier: "bot@example.org", label: "Bot" },
      baseDeps({ db }),
    );
    expect(result).toEqual({ ok: false, status: 409 });
  });
});

describe("addTeamExternalAccount live sync", () => {
  test("google: syncs only when the team has a linked google_group_email", async () => {
    const db = fakeDb({ team: { data: { github_team_slug: null, google_group_email: null } } });
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "google", identifier: "bot@example.org", label: "Bot" },
      baseDeps({ db, fetch: fetchFn }),
    );
    expect(result.ok).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("google: syncs via insertGroupMember when the team is linked", async () => {
    const db = fakeDb({ team: { data: { github_team_slug: null, google_group_email: "team@groups.example.org" } } });
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      expect(url).toContain("team%40groups.example.org/members");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "google", identifier: "bot@example.org", label: "Bot" },
      baseDeps({ db, fetch: fetchFn }),
    );
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalled();
  });

  test("github: syncs via putTeamMembership only when the team has a linked github_team_slug", async () => {
    const db = fakeDb({ team: { data: { github_team_slug: "software", google_group_email: null } } });
    let putCalled = false;
    const fetchFn = fakeGithubFetch((url) => {
      if (url.includes("/users/")) {
        return new Response(JSON.stringify({ id: 42, login: "bot" }), { status: 200 });
      }
      if (url.includes("/memberships/")) {
        putCalled = true;
        return new Response(JSON.stringify({ state: "active" }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "github", identifier: "bot", label: "Bot" },
      baseDeps({ db, fetch: fetchFn }),
    );
    expect(result.ok).toBe(true);
    expect(putCalled).toBe(true);
  });

  test("live sync throwing does not fail the add", async () => {
    const db = fakeDb({ team: { data: { github_team_slug: null, google_group_email: "team@groups.example.org" } } });
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await addTeamExternalAccount(
      "t1",
      { provider: "google", identifier: "bot@example.org", label: "Bot" },
      baseDeps({ db, fetch: fetchFn }),
    );
    expect(result.ok).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("removeTeamExternalAccount", () => {
  test("deletes the row and syncs via deleteGroupMember when linked", async () => {
    let deleted: unknown;
    const db = fakeDb({
      team: { data: { github_team_slug: null, google_group_email: "team@groups.example.org" } },
      onDelete: (match) => (deleted = match),
    });
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await removeTeamExternalAccount("t1", "google", "bot@example.org", baseDeps({ db, fetch: fetchFn }));
    expect(result.ok).toBe(true);
    expect(deleted).toMatchObject({ team_id: "t1", provider: "google", identifier: "bot@example.org" });
    expect(fetchFn).toHaveBeenCalled();
  });

  test("github: does not sync when the team has no linked github_team_slug", async () => {
    const db = fakeDb({ team: { data: { github_team_slug: null, google_group_email: null } } });
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const result = await removeTeamExternalAccount("t1", "github", "bot", baseDeps({ db, fetch: fetchFn }));
    expect(result.ok).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("zero rows matched: returns ok:true and does not sync (would strip a real member otherwise)", async () => {
    const db = fakeDb({
      team: { data: { github_team_slug: null, google_group_email: "team@groups.example.org" } },
      deleteResult: { data: [], error: null },
    });
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const result = await removeTeamExternalAccount(
      "t1",
      "google",
      "nobody@example.org",
      baseDeps({ db, fetch: fetchFn }),
    );
    expect(result).toEqual({ ok: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
