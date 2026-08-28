import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "./settings";
import { postChannelMessage, slackDepsFromEnv, type SlackDeps } from "./slack";

export type AlertSource = "first_sync" | "calendar_sync" | "drive_sync";

const LABELS: Record<AlertSource, string> = {
  first_sync: "FIRST roster sync",
  calendar_sync: "Google Calendar sync",
  drive_sync: "Google Drive group sync",
};

/**
 * Post an admin alert to #hub-admin-alerts only when a sync's health CHANGES
 * (ok→failing or failing→ok). Last-known state per source lives in
 * app_setting.slack_alert_state_<source> (default "ok"). This prevents the
 * every-15-min FIRST sync from posting ~96 alerts/day during an outage.
 * Never throws — alerting must not break the sync that called it.
 */
export async function reportSyncOutcome(
  source: AlertSource,
  ok: boolean,
  opts: { db: SupabaseClient; slack?: SlackDeps; error?: string },
): Promise<void> {
  try {
    const key = `slack_alert_state_${source}`;
    const prev = await getSetting<"ok" | "failing">(key, "ok", opts.db);
    const next = ok ? "ok" : "failing";

    // Post alert only if state changed
    let delivered = true;
    if (prev !== next) {
      const slack = opts.slack ?? slackDepsFromEnv();
      const text = ok
        ? `:white_check_mark: ${LABELS[source]} recovered — syncing normally again.`
        : `:rotating_light: ${LABELS[source]} is failing.${opts.error ? `\n\`\`\`${opts.error}\`\`\`` : ""}`;
      // Only advance state once the alert actually went out — a failed/no-op post
      // (e.g. token not yet configured) must re-alert next run, not swallow the transition.
      delivered = await postChannelMessage(slack, "hub-admin-alerts", text);
    }

    if (delivered) {
      await opts.db.from("app_setting").upsert({ key, value: next }, { onConflict: "key" });
    }
  } catch (e) {
    console.error(`[slack-alerts] reportSyncOutcome(${source}) threw:`, e);
  }
}
