import type { SupabaseClient } from "@supabase/supabase-js";
import {
  directoryCredentialsFromEnv,
  insertGroupMember,
  deleteGroupMember,
  type DirectoryCredentials,
} from "./google-directory";
import { githubAppCredentialsFromEnv, type GithubAppCredentials, type GithubDeps } from "./github-app";
import { getUserByLogin, putTeamMembership, deleteTeamMembership } from "./github-teams";

export type Provider = "google" | "github";

export type TeamExternalAccountRow = {
  team_id: string;
  provider: Provider;
  identifier: string;
  github_user_id: number | null;
  label: string;
  created_at: string;
};

export type AddExternalAccountInput = { provider: Provider; identifier: string; label: string };

export type ExternalAccountResult =
  | { ok: true; row: TeamExternalAccountRow }
  | { ok: false; status: 400 }
  | { ok: false; status: 404; reason: "github_user_not_found" }
  | { ok: false; status: 409 }
  | { ok: false; status: 500 };

export type RemoveExternalAccountResult = { ok: true } | { ok: false; status: 500 };

/** Deps for injection, mirroring syncMembershipChange()/syncGithubMembershipChange(). */
export type TeamExternalAccountDeps = {
  db: SupabaseClient;
  fetch: typeof fetch;
  directoryCredentials: DirectoryCredentials | null;
  githubCredentials: GithubAppCredentials | null;
};

const UNIQUE_VIOLATION = "23505";
const GITHUB_LOGIN_RE = /^[a-z0-9-]{1,39}$/;

async function resolveDeps(deps?: Partial<TeamExternalAccountDeps>): Promise<TeamExternalAccountDeps> {
  const db = deps?.db ?? (await import("./db")).getDb();
  return {
    db,
    fetch: deps?.fetch ?? globalThis.fetch,
    directoryCredentials: deps?.directoryCredentials ?? directoryCredentialsFromEnv(),
    githubCredentials: deps?.githubCredentials ?? githubAppCredentialsFromEnv(),
  };
}

function validGithubLogin(login: string): boolean {
  return GITHUB_LOGIN_RE.test(login) && !login.startsWith("-") && !login.endsWith("-");
}

export async function listTeamExternalAccounts(
  teamId: string,
  db?: SupabaseClient,
): Promise<TeamExternalAccountRow[]> {
  const c = db ?? (await import("./db")).getDb();
  const { data, error } = await c
    .from("team_external_account")
    .select("*")
    .eq("team_id", teamId)
    .order("label", { ascending: true })
    .order("provider", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamExternalAccountRow[];
}

/** Best-effort live sync, matching syncMembershipChange()/syncGithubMembershipChange(): logged, never thrown. */
async function liveSync(
  deps: TeamExternalAccountDeps,
  action: "add" | "remove",
  teamId: string,
  provider: Provider,
  identifier: string,
): Promise<void> {
  try {
    const { data: team, error } = await deps.db
      .from("team")
      .select("google_group_email, github_team_slug")
      .eq("id", teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const t = team as { google_group_email: string | null; github_team_slug: string | null } | null;

    if (provider === "google") {
      const groupEmail = t?.google_group_email;
      if (!groupEmail || !deps.directoryCredentials) return;
      const dirDeps = { fetch: deps.fetch, credentials: deps.directoryCredentials };
      if (action === "add") await insertGroupMember(dirDeps, groupEmail, identifier);
      else await deleteGroupMember(dirDeps, groupEmail, identifier);
    } else {
      const slug = t?.github_team_slug;
      if (!slug || !deps.githubCredentials) return;
      const ghDeps: GithubDeps = { fetch: deps.fetch, credentials: deps.githubCredentials };
      if (action === "add") await putTeamMembership(ghDeps, slug, identifier);
      else await deleteTeamMembership(ghDeps, slug, identifier);
    }
  } catch (error) {
    console.error("team external account live sync failed", { action, teamId, provider, identifier, error });
  }
}

export async function addTeamExternalAccount(
  teamId: string,
  input: AddExternalAccountInput,
  deps?: Partial<TeamExternalAccountDeps>,
): Promise<ExternalAccountResult> {
  const label = input.label.trim();
  if (!label || label.length > 80) return { ok: false, status: 400 };

  let identifier = input.identifier.trim().toLowerCase();
  if (!identifier) return { ok: false, status: 400 };

  const d = await resolveDeps(deps);
  let githubUserId: number | null = null;

  if (input.provider === "google") {
    if (!identifier.includes("@")) return { ok: false, status: 400 };
  } else {
    if (!validGithubLogin(identifier)) return { ok: false, status: 400 };
    if (!d.githubCredentials) return { ok: false, status: 500 };
    const ghDeps: GithubDeps = { fetch: d.fetch, credentials: d.githubCredentials };
    const user = await getUserByLogin(ghDeps, identifier);
    if (!user.ok) {
      if (user.status === 404) return { ok: false, status: 404, reason: "github_user_not_found" };
      return { ok: false, status: 500 };
    }
    identifier = user.user.login.toLowerCase();
    githubUserId = user.user.id;
  }

  const row = {
    team_id: teamId,
    provider: input.provider,
    identifier,
    github_user_id: githubUserId,
    label,
  };
  const { error } = await d.db.from("team_external_account").insert(row);
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };

  await liveSync(d, "add", teamId, input.provider, identifier);

  return { ok: true, row: { ...row, created_at: new Date().toISOString() } };
}

export async function removeTeamExternalAccount(
  teamId: string,
  provider: Provider,
  identifier: string,
  deps?: Partial<TeamExternalAccountDeps>,
): Promise<RemoveExternalAccountResult> {
  const d = await resolveDeps(deps);
  const normalized = identifier.trim().toLowerCase();
  const { data, error } = await d.db
    .from("team_external_account")
    .delete()
    .eq("team_id", teamId)
    .eq("provider", provider)
    .eq("identifier", normalized)
    .select("identifier");
  if (error) return { ok: false, status: 500 };

  // Nothing matched (already removed / never existed) — idempotent no-op, and
  // critically: skip liveSync so we don't strip a real person sharing this
  // email/login from the linked Google Group / GitHub Team.
  if (data && data.length > 0) {
    await liveSync(d, "remove", teamId, provider, normalized);
  }

  return { ok: true };
}
