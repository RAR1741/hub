import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { sendMentorReminders } from "@/lib/mentor-reminders";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_reminder_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await sendMentorReminders({ db, slack: slackDepsFromEnv() });
    return Response.json(result);
  } catch (e) {
    console.error("mentor reminders failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
