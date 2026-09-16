import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getTeam } from "@/lib/teams";
import { backfillTeamSlack } from "@/lib/team-slack-backfill";
import { directoryCredentialsFromEnv } from "@/lib/google-directory";
import { reconcileDriveGroups } from "@/lib/drive-group-sync";
import { githubAppCredentialsFromEnv } from "@/lib/github-app";
import { reconcileGithubTeams } from "@/lib/github-team-sync";
import { reportSyncOutcome } from "@/lib/slack-alerts";
import type { SupabaseClient } from "@supabase/supabase-js";

type Ctx = { params: Promise<{ id: string }> };

type ReconcileOutcome =
  | { status: "ok"; scope: number; added: number; errors: number }
  | { status: "not_configured" }
  | { status: "error"; message: string };

/**
 * One-shot "Invite all effective members" action for a team. Does two things,
 * so a structural change (re-parenting, or linking a channel/group/team)
 * propagates now instead of waiting for the nightly cron (Drive/GitHub) or
 * organic joins (Slack, which never self-heals):
 *
 *  1. Slack backfill — invite the team's effective (subtree) members to every
 *     linked channel. This is the only self-healing path Slack gets.
 *  2. Drive + GitHub reconcile on demand — the same whole-graph, idempotent
 *     reconcile the nightly cron runs. Whole-graph (not just this team) is
 *     deliberate: a re-parent changes an ANCESTOR's effective membership, so a
 *     single-team pass would miss exactly the group/team that needs updating.
 *
 * POST-only — a state-changing GET would be reachable cross-site and
 * `sameSite=lax` does not block top-level GET navigations (see AGENTS.md CSRF).
 */
export const POST = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const db = getDb();

  const team = await getTeam(id, db);
  if (!team) return Response.json({ error: "not_found" }, { status: 404 });

  // 1. Slack backfill for this team. A DB failure here is fatal to the action
  // (we never learned the effective members); Slack-side invite failures are
  // captured per-channel inside the summary, not thrown.
  let slack;
  try {
    slack = await backfillTeamSlack({ db }, id);
  } catch (e) {
    console.error("team backfill: slack failed:", e);
    return Response.json({ error: "slack_backfill_failed" }, { status: 502 });
  }

  // 2 + 3. Drive + GitHub reconcile. Each degrades independently — a missing
  // credential or a reconcile failure is reported in its own block rather than
  // sinking the whole action (the Slack backfill already succeeded).
  const drive = await runDriveReconcile(db);
  const github = await runGithubReconcile(db);

  return Response.json({ ok: true, slack, drive, github });
});

async function runDriveReconcile(db: SupabaseClient): Promise<ReconcileOutcome> {
  const credentials = directoryCredentialsFromEnv();
  if (!credentials) return { status: "not_configured" };
  const startedAt = Date.now();
  try {
    const result = await reconcileDriveGroups({ fetch: globalThis.fetch, db, credentials });
    const added = result.groups.reduce((n, g) => n + g.added.length, 0);
    const wouldRemove = result.groups.reduce((n, g) => n + g.wouldRemove.length, 0);
    const errors = result.groups.reduce((n, g) => n + g.errors.length, 0);
    await reportSyncOutcome("drive_sync", true, {
      db,
      startedAt,
      detail: { groups: result.groups.length, added, wouldRemove, errors },
    });
    return { status: "ok", scope: result.groups.length, added, errors };
  } catch (e) {
    console.error("team backfill: drive reconcile failed:", e);
    await reportSyncOutcome("drive_sync", false, { db, startedAt, error: e instanceof Error ? e : String(e) });
    return { status: "error", message: "sync_failed" };
  }
}

async function runGithubReconcile(db: SupabaseClient): Promise<ReconcileOutcome> {
  const credentials = githubAppCredentialsFromEnv();
  if (!credentials) return { status: "not_configured" };
  const startedAt = Date.now();
  try {
    const result = await reconcileGithubTeams({ fetch: globalThis.fetch, db, credentials });
    const added = result.teams.reduce((n, t) => n + t.added.length, 0);
    const pending = result.teams.reduce((n, t) => n + t.pending.length, 0);
    const wouldRemove = result.teams.reduce((n, t) => n + t.wouldRemove.length, 0);
    const errors = result.teams.reduce((n, t) => n + t.errors.length, 0);
    await reportSyncOutcome("github_sync", true, {
      db,
      startedAt,
      detail: { teams: result.teams.length, added, pending, wouldRemove, errors },
    });
    return { status: "ok", scope: result.teams.length, added, errors };
  } catch (e) {
    console.error("team backfill: github reconcile failed:", e);
    await reportSyncOutcome("github_sync", false, { db, startedAt, error: e instanceof Error ? e : String(e) });
    return { status: "error", message: "sync_failed" };
  }
}
