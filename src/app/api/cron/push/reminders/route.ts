import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { pushDepsFromEnv } from "@/lib/push-dispatch";
import { pushEventReminders } from "@/lib/event-reminder";
import { pushMeetingReminders } from "@/lib/meeting-reminder";
import { reportSubsystemHealth } from "@/lib/system-health";
import { recordCronHeartbeat, checkCronHeartbeats } from "@/lib/cron-heartbeat";

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
    // A swallowed query error (both libs log and return zeros) is otherwise
    // indistinguishable from a quiet window, so health keys off `errors`, not `sent`.
    const errors = events.errors + meetings.errors;
    await recordCronHeartbeat("push-reminders", db);
    await reportSubsystemHealth("push_reminders", errors === 0, {
      db,
      detail: `${errors} reminder query error(s) — check server logs.`,
    });
    // Every 5 min is the tightest schedule we run, so this is where the
    // per-job staleness sweep lives — no watcher job of its own (#301).
    await checkCronHeartbeats(db);
    return Response.json({ ok: true, events, meetings });
  } catch (e) {
    console.error("push-reminders failed:", e);
    await reportSubsystemHealth("push_reminders", false, { db, detail: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
