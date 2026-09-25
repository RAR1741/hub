import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { sendMentorReminders } from "@/lib/mentor-reminders";
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
    const result = await sendMentorReminders({ db, slack: slackDepsFromEnv() });
    await recordCronHeartbeat("slack-mentor-reminders-weekly", db);
    // `unlinked` is a data gap already named in the admin summary, not a delivery
    // failure — only a DM that Slack rejected counts against health.
    await reportSubsystemHealth("slack_mentor_reminders", result.failed.length === 0, {
      db,
      detail: `Slack DM failed for ${result.failed.length} mentor(s).`,
    });
    return Response.json(result);
  } catch (e) {
    console.error("mentor reminders failed:", e);
    await reportSubsystemHealth("slack_mentor_reminders", false, { db, detail: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
