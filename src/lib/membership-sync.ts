import type { SupabaseClient } from "@supabase/supabase-js";
import { syncMembershipChange as drive } from "./drive-group-sync";
import { syncGithubMembershipChange as github } from "./github-team-sync";
import { syncSlackMembershipChange as slack } from "./slack-channel-sync";

export async function syncMembershipChange(
  action: "add" | "remove",
  teamId: string,
  personId: string,
  db: SupabaseClient,
): Promise<void> {
  await Promise.allSettled([
    drive(action, teamId, personId, db),
    github(action, teamId, personId, db),
    slack(action, teamId, personId, db),
  ]);
}
