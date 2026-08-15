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
        .select("person (email, is_active)")
        .eq("team_id", team.id);
      type PersonJoin = { email: string | null; is_active: boolean };
      const expected = ((memberships ?? []) as unknown as { person: PersonJoin | PersonJoin[] | null }[])
        .map((m) => (Array.isArray(m.person) ? m.person[0] : m.person))
        .filter((p): p is PersonJoin => !!p && p.is_active && !!p.email)
        .map((p) => (p.email as string).toLowerCase());

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
      .select("email, is_active")
      .eq("id", personId)
      .maybeSingle();
    const p = person as { email: string | null; is_active: boolean } | null;
    if (!p || !p.email || !p.is_active) return;

    const dirDeps = { fetch: globalThis.fetch, credentials };
    if (action === "add") {
      await insertGroupMember(dirDeps, groupEmail, p.email);
    } else {
      await deleteGroupMember(dirDeps, groupEmail, p.email);
    }
  } catch (error) {
    console.error("drive-group sync failed", { action, teamId, personId, error });
  }
}
