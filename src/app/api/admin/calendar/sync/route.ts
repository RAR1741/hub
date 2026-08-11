import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { gcalCredentialsFromEnv, syncCalendar } from "@/lib/gcal";

export async function POST(request: Request) {
  const db = getDb();

  // Gate 1: shared secret (for pg_cron, which has no session). Empty secret never authorizes.
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("gcal_sync_secret", "", db);
  const secretOk = secret.length > 0 && provided === secret;

  // Gate 2: a mentor+ session.
  if (!secretOk) {
    const viewer = await getViewer();
    if (!hasRole(viewer.role, "mentor")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const calendarId = await getSetting<string>("gcal_calendar_id", "", db);
  const credentials = gcalCredentialsFromEnv(calendarId);
  if (!credentials) return Response.json({ error: "not_configured" }, { status: 400 });

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis", db);
  try {
    const result = await syncCalendar({ fetch: globalThis.fetch, db, credentials, tz });
    return Response.json(result);
  } catch {
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
