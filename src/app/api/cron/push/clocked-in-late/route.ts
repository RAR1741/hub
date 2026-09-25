import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { pushClockedInLate } from "@/lib/clocked-in-late";
import { reportSubsystemHealth } from "@/lib/system-health";
import { recordCronHeartbeat } from "@/lib/cron-heartbeat";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("push_cron_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await pushClockedInLate({ db });
    await recordCronHeartbeat("push-clocked-in-late", db);
    await reportSubsystemHealth("push_clocked_in_late", result.errors === 0, {
      db,
      detail: "Loading open sessions failed — check server logs.",
    });
    return Response.json(result);
  } catch (e) {
    console.error("clocked-in-late push failed:", e);
    await reportSubsystemHealth("push_clocked_in_late", false, { db, detail: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
