import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { secureEqual } from "@/lib/secure-compare";
import { syncFirstRoster } from "@/lib/first-sync";
import { reportSyncOutcome } from "@/lib/slack-alerts";

export async function POST(request: Request) {
  const db = getDb();

  // Gate 1: shared secret (for pg_cron, which has no session). Empty secret never authorizes.
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("first_sync_secret", "", db);
  const secretOk = secret.length > 0 && provided != null && secureEqual(provided, secret);

  // Gate 2: an admin session (mentors can't trigger/see this — FIRST roster data is admin-only).
  if (!secretOk) {
    const viewer = await getViewer();
    if (!hasRole(viewer.role, "admin")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  try {
    const report = await syncFirstRoster({ db });
    await reportSyncOutcome("first_sync", true, { db });
    return Response.json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish the two admin-actionable states from a generic failure.
    if (msg === "first_not_configured") {
      await reportSyncOutcome("first_sync", false, { db, error: msg });
      return Response.json({ error: "not_configured" }, { status: 400 });
    }
    if (msg === "first_session_expired") {
      await reportSyncOutcome("first_sync", false, {
        db,
        error: "FIRST session expired — re-paste a fresh cookie.",
      });
      return Response.json({ error: "session_expired" }, { status: 400 });
    }
    console.error("first sync failed:", e); // never logs the cookie
    await reportSyncOutcome("first_sync", false, { db, error: msg });
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
