import { describe, expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  DIRECTORY_SCOPE,
  deleteGroupMember,
  directoryCredentialsFromEnv,
  insertGroupMember,
  listGroupMembers,
  type DirectoryCredentials,
  type DirectoryDeps,
} from "./google-directory";

// A throwaway RSA key so the token-exchange JWT can actually sign in the test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDS: DirectoryCredentials = {
  clientEmail: "svc@proj.iam.gserviceaccount.com",
  privateKey: PEM,
  adminSubject: "admin@example.com",
};

function decodeAssertionClaims(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  const assertion = params.get("assertion")!;
  const [, claimsB64] = assertion.split(".");
  return JSON.parse(Buffer.from(claimsB64, "base64url").toString());
}

type CapturedRequest = { url: string; init?: RequestInit };

// Fake fetch: dispatches on URL (token endpoint vs Directory members endpoint)
// against a queue of canned responses, and records every request it received.
function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    requests.push({ url: href, init });
    if (href.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const next = queue.shift();
    if (!next) throw new Error(`no fake response queued for ${href}`);
    return new Response(next.body !== undefined ? JSON.stringify(next.body) : undefined, {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, requests };
}

describe("directoryCredentialsFromEnv", () => {
  test("reads and restores the private key from env vars", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
      subject: process.env.GOOGLE_ADMIN_SUBJECT,
    };
    process.env.GOOGLE_SA_CLIENT_EMAIL = "svc@proj.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    process.env.GOOGLE_ADMIN_SUBJECT = "admin@example.com";
    try {
      expect(directoryCredentialsFromEnv()).toEqual({
        clientEmail: "svc@proj.iam.gserviceaccount.com",
        privateKey: "line1\nline2",
        adminSubject: "admin@example.com",
      });
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
      process.env.GOOGLE_ADMIN_SUBJECT = prev.subject;
    }
  });

  test("returns null when any var is missing", () => {
    const prev = {
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: process.env.GOOGLE_SA_PRIVATE_KEY,
      subject: process.env.GOOGLE_ADMIN_SUBJECT,
    };
    delete process.env.GOOGLE_SA_CLIENT_EMAIL;
    process.env.GOOGLE_SA_PRIVATE_KEY = "line1\\nline2";
    process.env.GOOGLE_ADMIN_SUBJECT = "admin@example.com";
    try {
      expect(directoryCredentialsFromEnv()).toBeNull();
    } finally {
      process.env.GOOGLE_SA_CLIENT_EMAIL = prev.email;
      process.env.GOOGLE_SA_PRIVATE_KEY = prev.key;
      process.env.GOOGLE_ADMIN_SUBJECT = prev.subject;
    }
  });
});

describe("listGroupMembers", () => {
  test("lowercases emails and follows pagination", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { members: [{ email: "Alice@Example.com" }], nextPageToken: "p2" } },
      { status: 200, body: { members: [{ email: "BOB@example.com" }] } },
    ]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    const emails = await listGroupMembers(deps, "team@group.example.com");
    expect(emails).toEqual(["alice@example.com", "bob@example.com"]);

    const memberRequests = requests.filter((r) => r.url.includes("/members"));
    expect(memberRequests).toHaveLength(2);
    expect(memberRequests[0].url).toContain(
      "https://admin.googleapis.com/admin/directory/v1/groups/team%40group.example.com/members",
    );
    expect(memberRequests[0].url).toContain("maxResults=200");
    expect(memberRequests[1].url).toContain("pageToken=p2");
    for (const r of memberRequests) {
      expect((r.init?.headers as Record<string, string>)?.Authorization).toBe("Bearer fake-token");
    }
  });

  test("returns an empty array when the group has no members", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: {} }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    expect(await listGroupMembers(deps, "team@group.example.com")).toEqual([]);
  });

  test("skips members with no email instead of throwing", async () => {
    const { fetchFn } = fakeFetch([
      {
        status: 200,
        body: { members: [{ email: "Real@Example.com" }, { role: "MEMBER" }] },
      },
    ]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    await expect(listGroupMembers(deps, "team@group.example.com")).resolves.toEqual([
      "real@example.com",
    ]);
  });
});

describe("insertGroupMember", () => {
  test("ok on 200", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: {} }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    const result = await insertGroupMember(deps, "team@group.example.com", "New@Person.com");
    expect(result).toEqual({ ok: true, status: 200 });

    const insertReq = requests.find((r) => r.url.includes("/members") && r.init?.method === "POST")!;
    expect(insertReq.url).toBe(
      "https://admin.googleapis.com/admin/directory/v1/groups/team%40group.example.com/members",
    );
    expect(JSON.parse(insertReq.init!.body as string)).toEqual({
      email: "New@Person.com",
      role: "MEMBER",
    });
    expect((insertReq.init?.headers as Record<string, string>)?.Authorization).toBe("Bearer fake-token");
  });

  test("409 (already a member) is treated as ok", async () => {
    const { fetchFn } = fakeFetch([{ status: 409, body: { error: "conflict" } }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    const result = await insertGroupMember(deps, "team@group.example.com", "x@example.com");
    expect(result).toEqual({ ok: true, status: 409 });
  });

  test("not-ok on 500", async () => {
    const { fetchFn } = fakeFetch([{ status: 500, body: { error: "boom" } }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    const result = await insertGroupMember(deps, "team@group.example.com", "x@example.com");
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("deleteGroupMember", () => {
  test("ok on 200", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: {} }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    const result = await deleteGroupMember(deps, "team@group.example.com", "Gone@Example.com");
    expect(result).toEqual({ ok: true, status: 200 });

    const delReq = requests.find((r) => r.init?.method === "DELETE")!;
    expect(delReq.url).toBe(
      "https://admin.googleapis.com/admin/directory/v1/groups/team%40group.example.com/members/Gone%40Example.com",
    );
  });

  test("404 (already gone) is treated as ok", async () => {
    const { fetchFn } = fakeFetch([{ status: 404, body: { error: "not found" } }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    const result = await deleteGroupMember(deps, "team@group.example.com", "x@example.com");
    expect(result).toEqual({ ok: true, status: 404 });
  });

  test("not-ok on 500", async () => {
    const { fetchFn } = fakeFetch([{ status: 500, body: { error: "boom" } }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS };
    const result = await deleteGroupMember(deps, "team@group.example.com", "x@example.com");
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("token exchange", () => {
  test("every exported call fetches a token whose assertion carries sub = adminSubject", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: {} }]);
    const deps: DirectoryDeps = { fetch: fetchFn, credentials: CREDS, now: () => 1_700_000_000_000 };
    await insertGroupMember(deps, "team@group.example.com", "x@example.com");

    const tokenReq = requests.find((r) => r.url.includes("oauth2.googleapis.com/token"))!;
    const claims = decodeAssertionClaims(tokenReq.init!.body as string);
    expect(claims.sub).toBe(CREDS.adminSubject);
    expect(claims.scope).toBe(DIRECTORY_SCOPE);
  });
});
