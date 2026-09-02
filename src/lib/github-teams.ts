import { fetchInstallationToken, githubHeaders, type GithubDeps } from "./github-app";

export type GithubUser = { id: number; login: string };

const PER_PAGE = 100;

function teamUrl(org: string, slug: string, suffix: string): string {
  return `https://api.github.com/orgs/${org}/teams/${slug}/${suffix}`;
}

/** List every member of a team, lowercased, following pagination. Includes child-team members. */
export async function listTeamMembers(deps: GithubDeps, slug: string): Promise<GithubUser[]> {
  const token = await fetchInstallationToken(deps);
  const members: GithubUser[] = [];
  let page = 1;
  for (;;) {
    const url = new URL(teamUrl(deps.credentials.org, slug, "members"));
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    const res = await deps.fetch(url.toString(), { headers: githubHeaders(token) });
    if (!res.ok) throw new Error(`list team members failed: ${res.status}`);
    const json = (await res.json()) as { id: number; login: string }[];
    for (const m of json) {
      // ponytail: logins are stored lowercased (case-insensitive on GitHub); a self-healed github_login may display lowercase. Preserve original casing only if display fidelity is ever needed.
      members.push({ id: m.id, login: m.login.toLowerCase() });
    }
    if (json.length < PER_PAGE) break;
    page += 1;
  }
  return members;
}

/** Lowercased logins with a pending org invitation for this team. Skips email invites and failed ones. */
export async function listPendingTeamInvitations(deps: GithubDeps, slug: string): Promise<string[]> {
  const token = await fetchInstallationToken(deps);
  const logins: string[] = [];
  let page = 1;
  for (;;) {
    const url = new URL(teamUrl(deps.credentials.org, slug, "invitations"));
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    const res = await deps.fetch(url.toString(), { headers: githubHeaders(token) });
    if (!res.ok) throw new Error(`list team invitations failed: ${res.status}`);
    const json = (await res.json()) as { login: string | null; failed_at: string | null }[];
    for (const inv of json) if (inv.login && !inv.failed_at) logins.push(inv.login.toLowerCase());
    if (json.length < PER_PAGE) break;
    page += 1;
  }
  return logins;
}

/** Add (or invite) a user to a team. Adds directly if already an org member, else invites. */
export async function putTeamMembership(
  deps: GithubDeps,
  slug: string,
  username: string,
): Promise<{ ok: boolean; status: number; state?: "active" | "pending" }> {
  const token = await fetchInstallationToken(deps);
  const res = await deps.fetch(teamUrl(deps.credentials.org, slug, `memberships/${encodeURIComponent(username)}`), {
    method: "PUT",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ role: "member" }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = (await res.json()) as { state?: "active" | "pending" };
  return { ok: true, status: res.status, state: json.state };
}

/** Remove a user from a team (keeps org membership). Idempotent: 404 counts as ok. */
export async function deleteTeamMembership(
  deps: GithubDeps,
  slug: string,
  username: string,
): Promise<{ ok: boolean; status: number }> {
  const token = await fetchInstallationToken(deps);
  const res = await deps.fetch(teamUrl(deps.credentials.org, slug, `memberships/${encodeURIComponent(username)}`), {
    method: "DELETE",
    headers: githubHeaders(token),
  });
  return { ok: res.ok || res.status === 404, status: res.status };
}
