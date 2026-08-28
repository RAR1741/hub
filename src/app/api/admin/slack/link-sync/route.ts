import { getDb } from "@/lib/db";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { slackDepsFromEnv } from "@/lib/slack";
import { syncSlackLinks } from "@/lib/slack-link";

export async function POST() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) return Response.json({ error: "forbidden" }, { status: 403 });

  const slack = slackDepsFromEnv();
  if (!slack.token) return Response.json({ error: "not_configured", have: { token: false } }, { status: 400 });

  try {
    const report = await syncSlackLinks({ db: getDb(), slack });
    return Response.json(report);
  } catch (e) {
    console.error("slack link-sync failed:", e);
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
