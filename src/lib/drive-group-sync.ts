import type { SupabaseClient } from "@supabase/supabase-js";
import {
  directoryCredentialsFromEnv,
  insertGroupMember,
  deleteGroupMember,
  listGroupMembers,
  type DirectoryCredentials,
} from "./google-directory";

/** Diff expected vs actual group membership. PURE, case-insensitive, deduped. */
export function computeGroupDiff(
  expected: string[],
  actual: string[],
): { missing: string[]; extra: string[] } {
  const norm = (list: string[]) => new Set(list.map((e) => e.toLowerCase()));
  const expectedSet = norm(expected);
  const actualSet = norm(actual);
  const missing = [...expectedSet].filter((e) => !actualSet.has(e));
  const extra = [...actualSet].filter((e) => !expectedSet.has(e));
  return { missing, extra };
}

export type GroupReconcileReport = {
  teamName: string;
  groupEmail: string;
  expectedCount: number;
  actualCount: number;
  added: string[]; // inserted this run (or failed-to-insert listed in errors)
  wouldRemove: string[]; // in group, not expected — REPORT ONLY, never removed
  errors: string[];
};

export type ReconcileResult = { ranAt: string; groups: GroupReconcileReport[] };

type LinkedTeamRow = { id: string; name: string; google_group_email: string };

export async function reconcileDriveGroups(deps: {
  db: SupabaseClient;
  fetch: typeof globalThis.fetch;
  credentials: DirectoryCredentials;
  now?: () => number;
}): Promise<ReconcileResult> {
  const { db, fetch, credentials, now } = deps;
  const dirDeps = { fetch, credentials, now };

  const { data } = await db
    .from("team")
    .select("id, name, google_group_email")
    .not("google_group_email", "is", null);
  const linkedTeams = (data ?? []) as LinkedTeamRow[];

  const groups: GroupReconcileReport[] = [];

  for (const team of linkedTeams) {
    const groupEmail = team.google_group_email;
    const report: GroupReconcileReport = {
      teamName: team.name,
      groupEmail,
      expectedCount: 0,
      actualCount: 0,
      added: [],
      wouldRemove: [],
      errors: [],
    };
    try {
      const { data: memberships } = await db
        .from("team_membership")
        .select("person (is_active, person_identity (email))")
        .eq("team_id", team.id);
      type IdentityJoin = { email: string };
      type PersonJoin = {
        is_active: boolean;
        person_identity: IdentityJoin | IdentityJoin[] | null;
      };
      const expected = ((memberships ?? []) as unknown as { person: PersonJoin | PersonJoin[] | null }[])
        .map((m) => (Array.isArray(m.person) ? m.person[0] : m.person))
        .filter((p): p is PersonJoin => !!p && p.is_active)
        .flatMap((p) =>
          (Array.isArray(p.person_identity)
            ? p.person_identity
            : p.person_identity
              ? [p.person_identity]
              : []
          ).map((i) => i.email.toLowerCase()),
        );

      const actual = await listGroupMembers(dirDeps, groupEmail);
      report.expectedCount = expected.length;
      report.actualCount = actual.length;

      const { missing, extra } = computeGroupDiff(expected, actual);
      report.wouldRemove = extra;

      for (const email of missing) {
        try {
          const result = await insertGroupMember(dirDeps, groupEmail, email);
          if (result.ok) {
            report.added.push(email);
          } else {
            report.errors.push(`insert ${email} failed: ${result.status}`);
          }
        } catch (error) {
          report.errors.push(`insert ${email} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
    groups.push(report);
  }

  const result: ReconcileResult = {
    ranAt: new Date((now ? now() : Date.now())).toISOString(),
    groups,
  };

  await db.from("app_setting").upsert({ key: "drive_last_reconcile", value: result }, { onConflict: "key" });

  return result;
}

/**
 * Best-effort real-time sync for a single membership change.
 * Never throws. This is the ONLY automatic removal path, and it fires only
 * on an explicit removal from a linked team.
 */
export async function syncMembershipChange(
  action: "add" | "remove",
  teamId: string,
  personId: string,
  db: SupabaseClient,
): Promise<void> {
  try {
    const credentials = directoryCredentialsFromEnv();
    if (!credentials) return;

    const { data: team } = await db
      .from("team")
      .select("google_group_email")
      .eq("id", teamId)
      .maybeSingle();
    const groupEmail = (team as { google_group_email: string | null } | null)?.google_group_email;
    if (!groupEmail) return;

    const { data: person } = await db
      .from("person")
      .select("is_active, person_identity (email)")
      .eq("id", personId)
      .maybeSingle();
    type IdentityJoin = { email: string };
    const p = person as { is_active: boolean; person_identity: IdentityJoin | IdentityJoin[] | null } | null;
    const emails = !p || !p.is_active
      ? []
      : (Array.isArray(p.person_identity) ? p.person_identity : p.person_identity ? [p.person_identity] : [])
          .map((i) => i.email);
    if (emails.length === 0) return;

    const dirDeps = { fetch: globalThis.fetch, credentials };
    for (const email of emails) {
      if (action === "add") {
        await insertGroupMember(dirDeps, groupEmail, email);
      } else {
        await deleteGroupMember(dirDeps, groupEmail, email);
      }
    }
  } catch (error) {
    console.error("drive-group sync failed", { action, teamId, personId, error });
  }
}

export type AddRecommendation = { personId: string; name: string; labels: string[] };
export type TeamAddRecommendations = {
  teamId: string;
  teamName: string;
  groupEmail: string;
  people: AddRecommendation[];
};

/**
 * Derive "add these people to the team" recommendations from the last reconcile
 * report. A recommendation is a wouldRemove email that resolves to an ACTIVE
 * person who is NOT currently a member of that team. PURE. Keys are lowercased.
 *
 * The current-membership filter is load-bearing: after an add, the stored report
 * still lists the email in wouldRemove, so this filter is what drops added people
 * on the next page load. Do not remove it as "redundant".
 */
export function computeAddRecommendations(
  report: ReconcileResult,
  groupEmailToTeam: Map<string, { teamId: string; teamName: string }>,
  personByEmail: Map<string, { personId: string; name: string; isActive: boolean }>,
  membersByTeam: Map<string, Set<string>>,
): TeamAddRecommendations[] {
  const out: TeamAddRecommendations[] = [];
  for (const group of report.groups) {
    const team = groupEmailToTeam.get(group.groupEmail.toLowerCase());
    if (!team) continue;
    const members = membersByTeam.get(team.teamId) ?? new Set<string>();
    const byPerson = new Map<string, AddRecommendation>();
    for (const rawEmail of group.wouldRemove) {
      const email = rawEmail.toLowerCase();
      const person = personByEmail.get(email);
      if (!person || !person.isActive) continue;
      if (members.has(person.personId)) continue;
      const existing = byPerson.get(person.personId);
      if (existing) {
        existing.labels.push(email);
      } else {
        byPerson.set(person.personId, { personId: person.personId, name: person.name, labels: [email] });
      }
    }
    if (byPerson.size === 0) continue;
    const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
    out.push({ teamId: team.teamId, teamName: team.teamName, groupEmail: group.groupEmail, people });
  }
  return out.sort((a, b) => a.teamName.localeCompare(b.teamName));
}
