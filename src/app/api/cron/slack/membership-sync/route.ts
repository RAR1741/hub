import type { SupabaseClient } from "@supabase/supabase-js";
import { masqueradeReadOnly } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { syncSlackLinks } from "@/lib/slack-link";
import { reconcileAllTeamSlackChannels } from "@/lib/team-slack-backfill";
import { insertSyncRun } from "@/lib/sync-runs";
import { reportSubsystemHealth } from "@/lib/system-health";
import { recordCronHeartbeat } from "@/lib/cron-heartbeat";

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
  const startedAt = Date.now();
  try {
    // Link sync first so anyone newly matched to a slack_user_id is included
    // in this same run's channel reconcile.
    const links = await syncSlackLinks({ db, slack });
    const channels = await reconcileAllTeamSlackChannels({ db, slack });
    const detail = {
      linked: links.linked,
      alreadyLinked: links.alreadyLinked,
      ambiguous: links.ambiguous.length,
      channels: channels.totals.channels,
      invited: channels.totals.invited,
      alreadyIn: channels.totals.alreadyIn,
      failed: channels.totals.failed,
    };
    await recordRun({ ok: true, startedAt, detail }, db);
    // Cron path only: an admin clicking "Sync now" must not mask a cron that 403s.
    if (secretOk) await recordCronHeartbeat("slack-nightly-sync", db);
    await reportSubsystemHealth("slack_membership_sync", true, { db });
    return Response.json({ ok: true, links, channels });
  } catch (e) {
    console.error("slack membership-sync failed:", e);
    const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
    await recordRun({ ok: false, startedAt, error: message.slice(0, 8000) }, db);
    await reportSubsystemHealth("slack_membership_sync", false, {
      db,
      detail: e instanceof Error ? e.message : String(e),
    });
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}

/** Run history for /admin/sync-runs. A failed row write must never break the sync
 *  or suppress the health report, so it only logs — mirrors reportSyncOutcome. */
async function recordRun(
  row: { ok: boolean; startedAt: number; detail?: Record<string, number>; error?: string },
  db: SupabaseClient,
): Promise<void> {
  try {
    await insertSyncRun(
      { source: "slack_sync", ok: row.ok, startedAt: row.startedAt, error: row.error ?? null, detail: row.detail ?? null },
      db,
    );
  } catch (e) {
    console.error("[membership-sync] insertSyncRun threw:", e);
  }
}
