import { fetchGoogleAccessToken } from "./google-auth";

export type DirectoryCredentials = {
  clientEmail: string;
  privateKey: string;
  adminSubject: string;
};

export type DirectoryDeps = {
  fetch: typeof globalThis.fetch;
  credentials: DirectoryCredentials;
  now?: () => number;
};

export const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";

const MAX_RESULTS = 200;

function membersUrl(groupEmail: string): string {
  return `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`;
}

/** Read Directory API service-account creds from env; null if not fully configured. */
export function directoryCredentialsFromEnv(): DirectoryCredentials | null {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  // Private keys in env keep literal "\n"; restore real newlines for the PEM parser.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const adminSubject = process.env.GOOGLE_ADMIN_SUBJECT;
  if (!clientEmail || !privateKey || !adminSubject) return null;
  return { clientEmail, privateKey, adminSubject };
}

// One access token is reused for every call sharing the same `deps` object.
// A reconcile run builds a single `deps` and threads it through listing plus
// every insert, so the whole run costs one token exchange instead of N+1 —
// keeping us well clear of Google's token-endpoint rate limits (#45). The
// real-time hooks build a fresh `deps` per change, so they still fetch one
// token each, unchanged. Keyed by object identity via a WeakMap so cached
// promises are collected with their deps and never leak.
const tokenCache = new WeakMap<DirectoryDeps, Promise<string>>();

async function fetchAccessToken(deps: DirectoryDeps): Promise<string> {
  const cached = tokenCache.get(deps);
  if (cached) return cached;
  const promise = fetchGoogleAccessToken(
    deps.fetch,
    deps.credentials,
    { scope: DIRECTORY_SCOPE, subject: deps.credentials.adminSubject },
    deps.now,
  );
  tokenCache.set(deps, promise);
  return promise;
}

/** List every member email of a group, lowercased, following pagination. */
export async function listGroupMembers(deps: DirectoryDeps, groupEmail: string): Promise<string[]> {
  const token = await fetchAccessToken(deps);
  const emails: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(membersUrl(groupEmail));
    url.searchParams.set("maxResults", String(MAX_RESULTS));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await deps.fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`list members failed: ${res.status}`);
    const json = (await res.json()) as { members?: { email?: string }[]; nextPageToken?: string };
    for (const m of json.members ?? []) if (m.email) emails.push(m.email.toLowerCase());
    pageToken = json.nextPageToken;
  } while (pageToken);
  return emails;
}

/** Add a member to a group. Idempotent: 409 (already a member) counts as ok. */
export async function insertGroupMember(
  deps: DirectoryDeps,
  groupEmail: string,
  email: string,
): Promise<{ ok: boolean; status: number }> {
  const token = await fetchAccessToken(deps);
  const res = await deps.fetch(membersUrl(groupEmail), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, role: "MEMBER" }),
  });
  return { ok: res.ok || res.status === 409, status: res.status };
}

/** Remove a member from a group. Idempotent: 404 (already gone) counts as ok. */
export async function deleteGroupMember(
  deps: DirectoryDeps,
  groupEmail: string,
  email: string,
): Promise<{ ok: boolean; status: number }> {
  const token = await fetchAccessToken(deps);
  const res = await deps.fetch(`${membersUrl(groupEmail)}/${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: res.ok || res.status === 404, status: res.status };
}
