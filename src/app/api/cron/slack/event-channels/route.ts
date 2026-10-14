import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { sweepEventChannels, type SweepFailure } from "@/lib/slack-channels";
import { postChannelMessage, slackDepsFromEnv } from "@/lib/slack";
import { reportSubsystemHealth } from "@/lib/system-health";
import { recordCronHeartbeat } from "@/lib/cron-heartbeat";

const MAX_LISTED = 3;
const MAX_POSTS = 10;
const POST_GAP_MS = 1100; // Slack posts ~1/sec per channel

const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);
const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function describeFailure(f: SweepFailure): string {
  const hint = f.error === "restricted_action" ? " (archive it manually in Slack; after that the next sweep should record it as archived)" : "";
  return `${clip(f.event)} (#${f.channel ?? "unknown"}): ${f.op} failed${f.error ? ` — ${f.error}` : ""}${hint}`;
}

/** Collapse repeats (e.g. 30 failed invites to one channel) to one entry per event/channel/op/error. */
function uniqueFailures(failures: SweepFailure[]): SweepFailure[] {
  const seen = new Map<string, SweepFailure>();
  for (const f of failures) seen.set(JSON.stringify([f.event, f.channel, f.op, f.error]), f);
  return [...seen.values()];
}

function describeFailures(failed: number, failures: SweepFailure[]): string {
  const unique = uniqueFailures(failures);
  const lines = unique.slice(0, MAX_LISTED).map(describeFailure);
  const more = unique.length > MAX_LISTED ? `; +${unique.length - MAX_LISTED} more` : "";
  return lines.length > 0 ? `${lines.join("; ")}${more}` : `${failed} channel archive/rename/invite(s) failed.`;
}

/** One #hub-admin-alerts post per distinct failure, every run (deliberately noisy, no dedup across runs). Paced and capped; never throws. */
async function alertFailures(failures: SweepFailure[]): Promise<void> {
  try {
    const slack = slackDepsFromEnv();
    const unique = uniqueFailures(failures);
    for (const [i, f] of unique.slice(0, MAX_POSTS).entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, POST_GAP_MS));
      await postChannelMessage(slack, "hub-admin-alerts", `:warning: Event channel sweep: ${escapeSlack(describeFailure(f))}`);
    }
    if (unique.length > MAX_POSTS) {
      await new Promise((r) => setTimeout(r, POST_GAP_MS));
      await postChannelMessage(slack, "hub-admin-alerts", `:warning: Event channel sweep: +${unique.length - MAX_POSTS} more failing channels`);
    }
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
    await reportSubsystemHealth("slack_event_channels", result.failed === 0, {
      db,
      detail: describeFailures(result.failed, result.failures),
    });
    await alertFailures(result.failures);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("event channels sweep failed:", e);
    await reportSubsystemHealth("slack_event_channels", false, { db, detail: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
