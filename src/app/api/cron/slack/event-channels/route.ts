import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { sweepEventChannels } from "@/lib/slack-channels";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_event_channels_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await sweepEventChannels({ db });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("event channels sweep failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
