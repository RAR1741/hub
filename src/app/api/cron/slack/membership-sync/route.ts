import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { syncSlackLinks } from "@/lib/slack-link";
import { reconcileAllTeamSlackChannels } from "@/lib/team-slack-backfill";
import { reportSyncOutcome } from "@/lib/slack-alerts";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_sync_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
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
