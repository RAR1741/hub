import { describe, expect, test, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  deleteTeamMembership,
  listPendingTeamInvitations,
  listTeamMembers,
  putTeamMembership,
} from "./github-teams";
import type { GithubAppCredentials, GithubDeps } from "./github-app";

// A throwaway RSA key so fetchInstallationToken's JWT signing step doesn't blow up.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDS: GithubAppCredentials = {
  appId: "12345",
  privateKey: PEM,
  installationId: "999",
  org: "RAR1741",
  clientId: "client-id",
  clientSecret: "client-secret",
};

// fetchInstallationToken calls POST .../access_tokens once per deps; every
// other call in these tests is a plain REST call the fake fetch below
// dispatches by URL/method, mirroring drive-group-sync.test.ts's style.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function depsWith(handler: (url: string, init?: RequestInit) => Response): GithubDeps {
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/access_tokens")) {
      return jsonResponse({ token: "installation-token" }, 201);
    }
    return handler(url, init);
  });
  return {
    fetch: fetchFn as unknown as typeof fetch,
    credentials: CREDS,
    now: () => new Date(1_700_000_000_000),
  };
}

describe("listTeamMembers", () => {
  test("paginates across pages and lowercases logins", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, login: `User${i}` }));
    const page2 = [{ id: 100, login: "LastUser" }];
    const deps = depsWith((url) => {
      expect(url).toContain("/orgs/RAR1741/teams/software/members");
      expect(url).toContain("per_page=100");
      if (url.includes("page=2")) return jsonResponse(page2);
      return jsonResponse(page1);
    });

    const members = await listTeamMembers(deps, "software");
    expect(members).toHaveLength(101);
    expect(members[0]).toEqual({ id: 0, login: "user0" });
    expect(members[100]).toEqual({ id: 100, login: "lastuser" });
  });

  test("throws on a non-ok response", async () => {
    const deps = depsWith(() => jsonResponse({ message: "nope" }, 403));
    await expect(listTeamMembers(deps, "software")).rejects.toThrow("list team members failed: 403");
  });
});

describe("listPendingTeamInvitations", () => {
  test("skips null-login (email) invites and failed invites, lowercases the rest", async () => {
    const deps = depsWith((url) => {
      expect(url).toContain("/orgs/RAR1741/teams/software/invitations");
      return jsonResponse([
        { id: 1, login: "PendingUser", failed_at: null },
        { id: 2, login: null, email: "someone@example.com", failed_at: null },
        { id: 3, login: "FailedUser", failed_at: "2026-01-01T00:00:00Z" },
      ]);
    });

    const pending = await listPendingTeamInvitations(deps, "software");
    expect(pending).toEqual(["pendinguser"]);
  });

  test("throws on a non-ok response", async () => {
    const deps = depsWith(() => jsonResponse({ message: "nope" }, 500));
    await expect(listPendingTeamInvitations(deps, "software")).rejects.toThrow(
      "list team invitations failed: 500",
    );
  });
});

describe("putTeamMembership", () => {
  test("returns state from the response body", async () => {
    const deps = depsWith((url, init) => {
      expect(url).toBe("https://api.github.com/orgs/RAR1741/teams/software/memberships/octocat");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ role: "member" });
      return jsonResponse({ role: "member", state: "pending" });
    });

    const result = await putTeamMembership(deps, "software", "octocat");
    expect(result).toEqual({ ok: true, status: 200, state: "pending" });
  });
});

describe("deleteTeamMembership", () => {
  test("treats 404 as ok", async () => {
    const deps = depsWith((url, init) => {
      expect(url).toBe("https://api.github.com/orgs/RAR1741/teams/software/memberships/octocat");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 404 });
    });

    const result = await deleteTeamMembership(deps, "software", "octocat");
    expect(result).toEqual({ ok: true, status: 404 });
  });

  test("treats 204 as ok", async () => {
    const deps = depsWith(() => new Response(null, { status: 204 }));
    const result = await deleteTeamMembership(deps, "software", "octocat");
    expect(result).toEqual({ ok: true, status: 204 });
  });
});
