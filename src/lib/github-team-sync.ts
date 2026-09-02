import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listTeamMembers,
  listPendingTeamInvitations,
  putTeamMembership,
  deleteTeamMembership,
  type GithubUser,
} from "./github-teams";
import { githubAppCredentialsFromEnv, type GithubDeps, type GithubAppCredentials } from "./github-app";

/**
 * Diff expected vs actual GitHub team membership. PURE. Keyed on numeric `id`
 * (logins can be renamed, ids are stable). `pending` is matched by lowercased
 * login instead, because the invitations endpoint carries no user id.
 */
export function computeGithubTeamDiff(
  expected: GithubUser[],
  actual: GithubUser[],
  pendingLogins: string[],
): { missing: GithubUser[]; pending: string[]; extra: GithubUser[] } {
  const actualIds = new Set(actual.map((a) => a.id));
  const pendingSet = new Set(pendingLogins.map((l) => l.toLowerCase()));
  const missing: GithubUser[] = [];
  const pending: string[] = [];
  for (const e of expected) {
    if (actualIds.has(e.id)) continue;
    if (pendingSet.has(e.login.toLowerCase())) {
      pending.push(e.login);
    } else {
      missing.push(e);
    }
  }
  const expectedIds = new Set(expected.map((e) => e.id));
  const extra = actual.filter((a) => !expectedIds.has(a.id));
  return { missing, pending, extra };
}

export type GithubTeamReconcileReport = {
  teamName: string;
  teamSlug: string;
  expectedCount: number;
  actualCount: number;
  added: string[]; // logins PUT this run that came back state "active"
  pending: string[]; // logins with an outstanding org invitation (pre-existing or created this run)
  wouldRemove: GithubUser[]; // on the GitHub team, not expected — REPORT ONLY, never removed
  notConnected: string[]; // display names of active hub members with no github_user_id
  errors: string[];
};

export type GithubReconcileResult = { ranAt: string; teams: GithubTeamReconcileReport[] };

type LinkedTeamRow = { id: string; name: string; github_team_slug: string };
type MembershipPersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  github_login: string | null;
  github_user_id: number | null;
};

export async function reconcileGithubTeams(deps: {
  db: SupabaseClient;
  fetch: typeof globalThis.fetch;
  credentials: GithubAppCredentials;
  now?: () => Date;
}): Promise<GithubReconcileResult> {
  const { db, fetch, credentials, now } = deps;
  const ghDeps: GithubDeps = { fetch, credentials, now };

  const { data, error: teamsError } = await db
    .from("team")
    .select("id, name, github_team_slug")
    .not("github_team_slug", "is", null);
  if (teamsError) throw new Error(`list linked GitHub teams failed: ${teamsError.message}`);
  const linkedTeams = (data ?? []) as LinkedTeamRow[];

  const teams: GithubTeamReconcileReport[] = [];

  for (const team of linkedTeams) {
    const slug = team.github_team_slug;
    const report: GithubTeamReconcileReport = {
      teamName: team.name,
      teamSlug: slug,
      expectedCount: 0,
      actualCount: 0,
      added: [],
      pending: [],
      wouldRemove: [],
      notConnected: [],
      errors: [],
    };
    try {
      const { data: memberships, error: membershipError } = await db
        .from("team_membership")
        .select("person (id, first_name, last_name, is_active, github_login, github_user_id)")
        .eq("team_id", team.id);
      if (membershipError) throw new Error(membershipError.message);

      const people = ((memberships ?? []) as unknown as { person: MembershipPersonRow | MembershipPersonRow[] | null }[])
        .map((m) => (Array.isArray(m.person) ? m.person[0] : m.person))
        .filter((p): p is MembershipPersonRow => !!p && p.is_active);

      const expected: GithubUser[] = people
        .filter((p) => p.github_user_id != null && p.github_login)
        .map((p) => ({ id: p.github_user_id as number, login: p.github_login as string }));
      const expectedById = new Map(
        people
          .filter((p) => p.github_user_id != null)
          .map((p) => [p.github_user_id as number, p]),
      );
      report.notConnected = people
        .filter((p) => p.github_user_id == null)
        .map((p) => `${p.first_name} ${p.last_name}`);

      const actual = await listTeamMembers(ghDeps, slug);
      const pendingLogins = await listPendingTeamInvitations(ghDeps, slug);
      report.expectedCount = expected.length;
      report.actualCount = actual.length;

      // Login self-heal: an actual member whose id matches an expected person
      // but whose login differs (renamed account) gets healed in place.
      for (const member of actual) {
        const person = expectedById.get(member.id);
        if (!person) continue;
        if ((person.github_login ?? "").toLowerCase() === member.login.toLowerCase()) continue;
        const { error: updateError } = await db
          .from("person")
          .update({ github_login: member.login })
          .eq("id", person.id);
        if (updateError) report.errors.push(`update login for ${person.id} failed: ${updateError.message}`);
      }

      const diff = computeGithubTeamDiff(expected, actual, pendingLogins);
      report.pending = [...diff.pending];
      report.wouldRemove = diff.extra;

      for (const user of diff.missing) {
        try {
          const result = await putTeamMembership(ghDeps, slug, user.login);
          if (result.ok && result.state === "active") {
            report.added.push(user.login);
          } else if (result.ok && result.state === "pending") {
            report.pending.push(user.login);
          } else if (result.status === 404) {
            report.errors.push(`${user.login}: not found on GitHub; ask them to reconnect`);
          } else {
            report.errors.push(`${user.login}: HTTP ${result.status}`);
          }
        } catch (error) {
          report.errors.push(`${user.login}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
    teams.push(report);
  }

  const result: GithubReconcileResult = {
    ranAt: (now ? now() : new Date()).toISOString(),
    teams,
  };

  await db.from("app_setting").upsert({ key: "github_last_reconcile", value: result }, { onConflict: "key" });

  return result;
}

/**
 * Best-effort real-time sync for a single membership change.
 * Never throws. This is the ONLY automatic removal path, and it fires only
 * on an explicit removal from a linked team.
 */
export async function syncGithubMembershipChange(
  action: "add" | "remove",
  teamId: string,
  personId: string,
  db: SupabaseClient,
): Promise<void> {
  try {
    const credentials = githubAppCredentialsFromEnv();
    if (!credentials) return;

    const { data: team } = await db.from("team").select("github_team_slug").eq("id", teamId).maybeSingle();
    const slug = (team as { github_team_slug: string | null } | null)?.github_team_slug;
    if (!slug) return;

    const { data: person } = await db.from("person").select("github_login").eq("id", personId).maybeSingle();
    const login = (person as { github_login: string | null } | null)?.github_login;
    if (!login) return;

    const ghDeps: GithubDeps = { fetch: globalThis.fetch, credentials };
    if (action === "add") {
      await putTeamMembership(ghDeps, slug, login);
    } else {
      await deleteTeamMembership(ghDeps, slug, login);
    }
  } catch (error) {
    console.error("github-team sync failed", { action, teamId, personId, error });
  }
}

/**
 * Called at the end of a successful "Connect GitHub". Best-effort, never
 * throws. PUTs the newly connected person onto every linked team they are
 * already a hub member of, so they don't wait for the nightly reconcile.
 */
export async function syncPersonLinkedTeams(personId: string, db: SupabaseClient): Promise<void> {
  try {
    const credentials = githubAppCredentialsFromEnv();
    if (!credentials) return;

    const { data: person } = await db.from("person").select("github_login").eq("id", personId).maybeSingle();
    const login = (person as { github_login: string | null } | null)?.github_login;
    if (!login) return;

    const { data: memberships } = await db
      .from("team_membership")
      .select("team (id, github_team_slug)")
      .eq("person_id", personId);
    type TeamJoin = { id: string; github_team_slug: string | null };
    const linkedSlugs = ((memberships ?? []) as unknown as { team: TeamJoin | TeamJoin[] | null }[])
      .map((m) => (Array.isArray(m.team) ? m.team[0] : m.team))
      .filter((t): t is TeamJoin => !!t && !!t.github_team_slug)
      .map((t) => t.github_team_slug as string);

    const ghDeps: GithubDeps = { fetch: globalThis.fetch, credentials };
    for (const slug of linkedSlugs) {
      await putTeamMembership(ghDeps, slug, login);
    }
  } catch (error) {
    console.error("github-team sync (person) failed", { personId, error });
  }
}

// TeamAddRecommendations in drive-group-sync.ts still uses `emails`; this
// mirrors it with `labels` per the design's task-12 field rename. ponytail:
// once task 12 renames the Drive field, these two near-identical types (and
// computeAddRecommendations/computeGithubAddRecommendations) should merge
// behind a shared key-extractor.
export type GithubAddRecommendation = { personId: string; name: string; labels: string[] };
export type TeamAddRecommendations = {
  teamId: string;
  teamName: string;
  teamSlug: string;
  people: GithubAddRecommendation[];
};

/**
 * Derive "add these people to the team" recommendations from the last
 * reconcile report. A recommendation is a wouldRemove GitHub user that
 * resolves to an ACTIVE hub person who is NOT currently a member of that
 * team. PURE.
 *
 * The current-membership filter is load-bearing: after an add, the stored
 * report still lists the user in wouldRemove, so this filter is what drops
 * added people on the next page load. Do not remove it as "redundant".
 */
export function computeGithubAddRecommendations(
  report: GithubReconcileResult,
  slugToTeam: Map<string, { teamId: string; teamName: string }>,
  personByGithubId: Map<number, { personId: string; name: string; isActive: boolean }>,
  membersByTeam: Map<string, Set<string>>,
): TeamAddRecommendations[] {
  const out: TeamAddRecommendations[] = [];
  for (const teamReport of report.teams) {
    const team = slugToTeam.get(teamReport.teamSlug);
    if (!team) continue;
    const members = membersByTeam.get(team.teamId) ?? new Set<string>();
    const byPerson = new Map<string, GithubAddRecommendation>();
    for (const user of teamReport.wouldRemove) {
      const person = personByGithubId.get(user.id);
      if (!person || !person.isActive) continue;
      if (members.has(person.personId)) continue;
      const existing = byPerson.get(person.personId);
      if (existing) {
        existing.labels.push(`@${user.login}`);
      } else {
        byPerson.set(person.personId, { personId: person.personId, name: person.name, labels: [`@${user.login}`] });
      }
    }
    if (byPerson.size === 0) continue;
    const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
    out.push({ teamId: team.teamId, teamName: team.teamName, teamSlug: teamReport.teamSlug, people });
  }
  return out.sort((a, b) => a.teamName.localeCompare(b.teamName));
}
