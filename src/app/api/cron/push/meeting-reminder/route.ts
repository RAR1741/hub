import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { pushMeetingReminders } from "@/lib/meeting-reminder";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("push_cron_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await pushMeetingReminders({ db, nowIso: new Date().toISOString() });
    return Response.json(result);
  } catch (e) {
    console.error("meeting-reminder push failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
