import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { gcalCredentialsFromEnv, pickCalendarId, syncCalendar } from "@/lib/gcal";

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

  // GOOGLE_CALENDAR_ID env var wins; otherwise the gcal_calendar_id app setting.
  const calendarId = pickCalendarId(
    process.env.GOOGLE_CALENDAR_ID,
    await getSetting<string>("gcal_calendar_id", "", db),
  );
  const credentials = gcalCredentialsFromEnv(calendarId);
  if (!credentials) {
    // Report which piece is missing (presence booleans only — never the values)
    // so a misconfigured env is diagnosable without leaking secrets.
    return Response.json(
      {
        error: "not_configured",
        have: {
          clientEmail: Boolean(process.env.GOOGLE_SA_CLIENT_EMAIL),
          privateKey: Boolean(process.env.GOOGLE_SA_PRIVATE_KEY),
          calendarId: Boolean(calendarId),
        },
      },
      { status: 400 },
    );
  }

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis", db);
  try {
    const result = await syncCalendar({ fetch: globalThis.fetch, db, credentials, tz });
    return Response.json(result);
  } catch (e) {
    // Surface the real cause server-side (bad calendar id, unshared calendar,
    // token/network failure) while keeping the client response generic.
    console.error("calendar sync failed:", e);
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
