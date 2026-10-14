import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { sweepEventChannels, type SweepFailure } from "@/lib/slack-channels";
import { postChannelMessage, slackDepsFromEnv } from "@/lib/slack";
import { reportSubsystemHealth } from "@/lib/system-health";
import { recordCronHeartbeat } from "@/lib/cron-heartbeat";

const MAX_LISTED = 3;

function describeFailure(f: SweepFailure): string {
  const hint = f.error === "restricted_action" ? " (archive it manually in Slack; the next sweep will record it)" : "";
  return `${f.event} (#${f.channel ?? "unknown"}): ${f.op} failed${f.error ? ` — ${f.error}` : ""}${hint}`;
}

function describeFailures(failed: number, failures: SweepFailure[]): string {
  const lines = failures.slice(0, MAX_LISTED).map(describeFailure);
  const more = failures.length > MAX_LISTED ? `; +${failures.length - MAX_LISTED} more` : "";
  return lines.length > 0 ? `${lines.join("; ")}${more}` : `${failed} channel archive/rename/invite(s) failed.`;
}

/** One #hub-admin-alerts post per failure, every run (deliberately noisy, no dedup). Never throws. */
async function alertFailures(failures: SweepFailure[]): Promise<void> {
  try {
    const slack = slackDepsFromEnv();
    for (const f of failures) await postChannelMessage(slack, "hub-admin-alerts", `:warning: Event channel sweep: ${describeFailure(f)}`);
  } catch (e) {
    console.error("event channels sweep: admin alert post failed:", e);
  }
}

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_event_channels_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await sweepEventChannels({ db });
    await recordCronHeartbeat("slack-event-channels-nightly", db);
    await alertFailures(result.failures);
    await reportSubsystemHealth("slack_event_channels", result.failed === 0, {
      db,
      detail: describeFailures(result.failed, result.failures),
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("event channels sweep failed:", e);
    await reportSubsystemHealth("slack_event_channels", false, { db, detail: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
