import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { secureEqual } from "@/lib/secure-compare";
import { slackDepsFromEnv } from "@/lib/slack";
import { githubAppCredentialsFromEnv } from "@/lib/github-app";
import { sendWhatsNewDigest } from "@/lib/whats-new";

export async function POST(request: Request) {
  const db = getDb();
  const provided = request.headers.get("x-sync-secret");
  const secret = await getSetting<string>("slack_reminder_secret", "", db);
  if (!(secret.length > 0 && provided != null && secureEqual(provided, secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await sendWhatsNewDigest({
      fetch: globalThis.fetch,
      slack: slackDepsFromEnv(),
      githubCredentials: githubAppCredentialsFromEnv(),
    });
    return Response.json(result);
  } catch (e) {
    console.error("whats-new digest failed:", e);
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
