import type { SupabaseClient } from "@supabase/supabase-js";
import { postChannelMessage, type SlackDeps } from "./slack";
import { pushDepsFromEnv, sanitizePushText, sendPushToOptedIn, type PushDeps } from "./push-dispatch";
import { reportSubsystemHealth } from "./system-health";

/** Post to #hub-admin-alerts AND push admin_alerts to opted-in admins.
 *  Also reports slack_delivery health via reportSubsystemHealth, so a swallowed
 *  #hub-admin-alerts post surfaces as a push on the ok<->failing transition.
 *  Returns Slack's delivered boolean UNCHANGED — reportSyncOutcome advances its
 *  state machine on it, so push outcome must never leak in. Push is awaited but
 *  can neither throw nor change the return value. */
export async function notifyAdmins(
  text: string,
  deps: { db: SupabaseClient; slack: SlackDeps; push?: PushDeps },
): Promise<boolean> {
  const delivered = await postChannelMessage(deps.slack, "hub-admin-alerts", text);
  try {
    const push = deps.push ?? pushDepsFromEnv();
    const { data } = await deps.db.from("person").select("id").eq("role", "admin");
    const adminIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (adminIds.length > 0) {
      await sendPushToOptedIn(
        adminIds,
        "admin_alerts",
        { title: "Admin alert", body: sanitizePushText(text), url: "/admin" },
        { db: deps.db, push },
      );
    }
    await reportSubsystemHealth("slack_delivery", delivered, {
      db: deps.db,
      push,
      detail: "chat.postMessage to #hub-admin-alerts failed — check SLACK_BOT_TOKEN and that the bot is invited to the channel.",
    });
  } catch (e) {
    console.error("[admin-notify] push fan-out failed (Slack unaffected):", e);
  }
  return delivered;
}
