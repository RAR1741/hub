import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAdmins } from "./admin-notify";
import { HUB_URL } from "./email-template";
import type { PushDeps } from "./push-dispatch";
import { getSetting } from "./settings";
import { slackDepsFromEnv, type SlackDeps } from "./slack";
import { insertSyncRun, SYNC_SOURCE_LABELS as LABELS } from "./sync-runs";

export type AlertSource = "first_sync" | "calendar_sync" | "drive_sync" | "github_sync" | "slack_sync";

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
  opts: {
    db: SupabaseClient;
    slack?: SlackDeps;
    push?: PushDeps;
    error?: string | Error;
    startedAt?: number;
    detail?: Record<string, number>;
  },
): Promise<void> {
  const message = opts.error instanceof Error ? opts.error.message : opts.error;

  // Own try/catch, before the alert logic: a failed row write must never suppress the alert.
  try {
    const errorText = ok
      ? null
      : (opts.error instanceof Error ? opts.error.stack ?? opts.error.message : opts.error ?? "unknown").slice(0, 8000);
    await insertSyncRun(
      {
        source,
        ok,
        startedAt: opts.startedAt ?? Date.now(),
        error: errorText,
        detail: ok ? opts.detail ?? null : null,
      },
      opts.db,
    );
  } catch (e) {
    console.error(`[slack-alerts] insertSyncRun(${source}) threw:`, e);
  }

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
        : `:rotating_light: ${LABELS[source]} is failing.${message ? `\n\`\`\`${message}\`\`\`` : ""}\n<${HUB_URL}/admin/sync-runs?source=${source}|View run history>`;
      // Only advance state once the alert actually went out — a failed/no-op post
      // (e.g. token not yet configured) must re-alert next run, not swallow the transition.
      delivered = await notifyAdmins(text, { db: opts.db, slack, push: opts.push });
    }

    if (delivered) {
      await opts.db.from("app_setting").upsert({ key, value: next }, { onConflict: "key" });
    }
  } catch (e) {
    console.error(`[slack-alerts] reportSyncOutcome(${source}) threw:`, e);
  }
}
