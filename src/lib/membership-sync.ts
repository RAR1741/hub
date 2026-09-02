import type { SupabaseClient } from "@supabase/supabase-js";
import { syncMembershipChange as drive } from "./drive-group-sync";
import { syncGithubMembershipChange as github } from "./github-team-sync";

export async function syncMembershipChange(
  action: "add" | "remove",
  teamId: string,
  personId: string,
  db: SupabaseClient,
): Promise<void> {
  await Promise.allSettled([
    drive(action, teamId, personId, db),
    github(action, teamId, personId, db),
  ]);
}
