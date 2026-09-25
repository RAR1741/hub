import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { githubAppCredentialsFromEnv } from "@/lib/github-app";
import { sendWhatsNewDigest } from "@/lib/whats-new";
import { reportSubsystemHealth } from "@/lib/system-health";
import { recordCronHeartbeat } from "@/lib/cron-heartbeat";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_reminder_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await sendWhatsNewDigest({
      fetch: globalThis.fetch,
      slack: slackDepsFromEnv(),
      githubCredentials: githubAppCredentialsFromEnv(),
      db,
    });
    await recordCronHeartbeat("slack-whats-new-weekly", db);
    // An empty window is a real success (the cursor advances); only a digest that
    // was formatted and then failed to post is a failure.
    await reportSubsystemHealth("slack_whats_new", result.count === 0 || result.posted, {
      db,
      detail: `Digest of ${result.count} PR(s) did not post to #hub-admin-alerts.`,
    });
    return Response.json(result);
  } catch (e) {
    console.error("whats-new digest failed:", e);
    await reportSubsystemHealth("slack_whats_new", false, { db, detail: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
