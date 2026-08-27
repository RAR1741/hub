import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { fetchWithSession, normalizeCookieHeader } from "@/lib/first-auth";

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const cookie = normalizeCookieHeader(String(body?.cookie ?? ""));
  if (cookie.length === 0) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const db = getDb();
  const teamProfileId = await getSetting<string | number | null>("first_team_profile_id", null, db);
  if (teamProfileId == null || String(teamProfileId).length === 0) {
    return Response.json({ error: "invalid_session" }, { status: 400 });
  }

  const rosterUrl = `https://my.firstinspires.org/Teams/Page/TeamContacts/TeamRoster?TeamProfileID=${teamProfileId}`;
  try {
    const res = await fetchWithSession(rosterUrl, cookie);
    if (res.kind !== "ok" || !res.body.includes("teamContactsModel")) {
      return Response.json({ error: "invalid_session" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "invalid_session" }, { status: 400 });
  }

  const { error } = await db
    .from("app_setting")
    .upsert({ key: "first_session", value: { cookie, savedAt: new Date().toISOString() } }, { onConflict: "key" });
  if (error) {
    return Response.json({ error: "failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
