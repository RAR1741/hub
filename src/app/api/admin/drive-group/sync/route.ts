import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { secureEqual } from "@/lib/secure-compare";
import { directoryCredentialsFromEnv } from "@/lib/google-directory";
import { reconcileDriveGroups } from "@/lib/drive-group-sync";
import { reportSyncOutcome } from "@/lib/slack-alerts";

export async function POST(request: Request) {
  const db = getDb();

  // Gate 1: shared secret (for pg_cron, which has no session). Empty secret never authorizes.
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("drive_sync_secret", "", db);
  const secretOk = secret.length > 0 && provided != null && secureEqual(provided, secret);

  // Gate 2: a mentor+ session.
  if (!secretOk) {
    const viewer = await getViewer();
    if (!hasRole(viewer.role, "mentor")) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const credentials = directoryCredentialsFromEnv();
  if (!credentials) {
    // Report which piece is missing (presence booleans only — never the values)
    // so a misconfigured env is diagnosable without leaking secrets.
    return Response.json(
      {
        error: "not_configured",
        have: {
          clientEmail: Boolean(process.env.GOOGLE_SA_CLIENT_EMAIL),
          privateKey: Boolean(process.env.GOOGLE_SA_PRIVATE_KEY),
          adminSubject: Boolean(process.env.GOOGLE_ADMIN_SUBJECT),
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await reconcileDriveGroups({ fetch: globalThis.fetch, db, credentials });
    await reportSyncOutcome("drive_sync", true, { db });
    return Response.json(result);
  } catch (e) {
    // Surface the real cause server-side (bad group id, token/network failure)
    // while keeping the client response generic.
    console.error("drive-group sync failed:", e);
    await reportSyncOutcome("drive_sync", false, { db, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
