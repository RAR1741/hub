import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { pushDepsFromEnv } from "@/lib/push-dispatch";
import { pushEventReminders } from "@/lib/event-reminder";
import { pushMeetingReminders } from "@/lib/meeting-reminder";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("push_cron_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const push = pushDepsFromEnv();
    const [events, meetings] = await Promise.all([
      pushEventReminders({ db, push }),
      pushMeetingReminders({ db, push }),
    ]);
    return Response.json({ ok: true, events, meetings });
  } catch (e) {
    console.error("push-reminders failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
