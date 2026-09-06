import type { SupabaseClient } from "@supabase/supabase-js";
import { syncMembershipChange as drive } from "./drive-group-sync";
import { syncGithubMembershipChange as github } from "./github-team-sync";
import { syncSlackMembershipChange as slack } from "./slack-channel-sync";
import { ancestorIds, subtreeIds, type TeamLink } from "./team-tree";

async function loadTree(db: SupabaseClient): Promise<TeamLink[] | null> {
  const { data, error } = await db.from("team").select("id, parent_team_id");
  if (error || !data) return null;
  return data.map((t: { id: string; parent_team_id: string | null }) => ({
    id: t.id,
    parentTeamId: t.parent_team_id,
  }));
}

async function syncOne(action: "add" | "remove", teamId: string, personId: string, db: SupabaseClient) {
  await Promise.allSettled([
    drive(action, teamId, personId, db),
    github(action, teamId, personId, db),
    slack(action, teamId, personId, db),
  ]);
}

export async function syncMembershipChange(
  action: "add" | "remove",
  teamId: string,
  personId: string,
  db: SupabaseClient,
): Promise<void> {
  const tree = await loadTree(db);

  if (action === "add") {
    // Never let the umbrella feature reduce what happened before: a failed tree
    // read still fires the direct sync.
    const targets = tree ? [teamId, ...ancestorIds(tree, teamId)] : [teamId];
    for (const target of targets) {
      await syncOne("add", target, personId, db);
    }
    return;
  }

  // remove: scoped to the direct team only, but skip entirely if the person is
  // still an effective member via a surviving row anywhere in the subtree —
  // removeMember() has already deleted teamId's own row before calling this.
  if (!tree) return;
  const { data, error } = await db
    .from("team_membership")
    .select("team_id")
    .in("team_id", subtreeIds(tree, teamId))
    .eq("person_id", personId);
  if (error || (data ?? []).length > 0) return;

  await syncOne("remove", teamId, personId, db);
}
