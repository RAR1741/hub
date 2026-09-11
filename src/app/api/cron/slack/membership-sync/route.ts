import { masqueradeReadOnly } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { syncSlackLinks } from "@/lib/slack-link";
import { reconcileAllTeamSlackChannels } from "@/lib/team-slack-backfill";
import { reportSyncOutcome } from "@/lib/slack-alerts";

export async function POST(request: Request) {
  const db = getDb();

  // Gate 1: shared secret (for pg_cron, which has no session). Empty secret never authorizes.
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_sync_secret", "", db);
  const secretOk = secret.length > 0 && provided != null && secureEqual(provided, secret);

  // Gate 2: an admin session.
  if (!secretOk) {
    const viewer = await getViewer();
    if (!hasRole(viewer.role, "admin")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const blocked = masqueradeReadOnly(viewer);
    if (blocked) return blocked;
  }

  const slack = slackDepsFromEnv();
  try {
    // Link sync first so anyone newly matched to a slack_user_id is included
    // in this same run's channel reconcile.
    const links = await syncSlackLinks({ db, slack });
    const channels = await reconcileAllTeamSlackChannels({ db, slack });
    await reportSyncOutcome("slack_sync", true, { db });
    return Response.json({ ok: true, links, channels });
  } catch (e) {
    console.error("slack membership-sync failed:", e);
    await reportSyncOutcome("slack_sync", false, { db, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
