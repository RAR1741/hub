import type { SupabaseClient } from "@supabase/supabase-js";
import { postChannelMessage, type SlackDeps } from "./slack";
import { pushDepsFromEnv, sanitizePushText, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

/** Post to #hub-admin-alerts AND push admin_alerts to opted-in admins.
 *  Returns Slack's delivered boolean UNCHANGED — reportSyncOutcome advances its
 *  state machine on it, so push outcome must never leak in. Push is awaited but
 *  can neither throw nor change the return value. */
export async function notifyAdmins(
  text: string,
  deps: { db: SupabaseClient; slack: SlackDeps; push?: PushDeps },
): Promise<boolean> {
  const delivered = await postChannelMessage(deps.slack, "hub-admin-alerts", text);
  try {
    const { data } = await deps.db.from("person").select("id").eq("role", "admin");
    const adminIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (adminIds.length > 0) {
      const push = deps.push ?? pushDepsFromEnv();
      await sendPushToOptedIn(
        adminIds,
        "admin_alerts",
        { title: "Admin alert", body: sanitizePushText(text), url: "/admin" },
        { db: deps.db, push },
      );
    }
  } catch (e) {
    console.error("[admin-notify] push fan-out failed (Slack unaffected):", e);
  }
  return delivered;
}
