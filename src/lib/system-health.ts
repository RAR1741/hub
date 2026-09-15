import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "./settings";
import { pushDepsFromEnv, sanitizePushText, sendPushToOptedIn, type PushDeps } from "./push-dispatch";

export type HealthSubsystem =
  | "slack_delivery"
  | "push_reminders"
  | "push_clocked_in_late"
  | "slack_whats_new"
  | "slack_mentor_reminders"
  | "slack_event_channels"
  | "slack_membership_sync";

const LABELS: Record<HealthSubsystem, string> = {
  slack_delivery: "Slack admin-alert delivery",
  push_reminders: "Event/meeting reminder push",
  push_clocked_in_late: "Clocked-in-late push",
  slack_whats_new: "What's-New digest",
  slack_mentor_reminders: "Weekly mentor reminders",
  slack_event_channels: "Event channel sweep",
  slack_membership_sync: "Slack membership sync",
};

/**
 * Push to opted-in admins only when a subsystem's health CHANGES (ok→failing
 * or failing→ok). Last-known state per subsystem lives in
 * app_setting.system_health_state_<subsystem> (default "ok"). State advances
 * only once a push actually went out (sent > 0) — mirrors reportSyncOutcome's
 * "advance only when delivered", so a rollout with zero opted-in admins keeps
 * re-alerting on the next call instead of silently recording a transition
 * nobody received. Never throws.
 */
export async function reportSubsystemHealth(
  subsystem: HealthSubsystem,
  ok: boolean,
  deps: { db: SupabaseClient; push?: PushDeps; detail?: string },
): Promise<void> {
  try {
    const key = `system_health_state_${subsystem}`;
    const prev = await getSetting<"ok" | "failing">(key, "ok", deps.db);
    const next = ok ? "ok" : "failing";

    if (prev === next) {
      await deps.db.from("app_setting").upsert({ key, value: next }, { onConflict: "key" });
      return;
    }

    // Duplicated from admin-notify.ts deliberately — importing it would create a cycle.
    const { data, error } = await deps.db.from("person").select("id").eq("role", "admin");
    if (error) {
      console.error(`[system-health] load admins failed for ${subsystem}:`, error.message);
      return;
    }
    const adminIds = ((data ?? []) as { id: string }[]).map((r) => r.id);

    const payload = {
      title: ok ? `${LABELS[subsystem]} recovered` : `${LABELS[subsystem]} failing`,
      body: sanitizePushText(ok ? "Working again." : (deps.detail ?? "Check server logs.")),
      url: "/admin",
    };
    const push = deps.push ?? pushDepsFromEnv();

    let sent = 0;
    if (adminIds.length > 0) {
      ({ sent } = await sendPushToOptedIn(adminIds, "system_health", payload, { db: deps.db, push }));
    }

    if (sent > 0) {
      await deps.db.from("app_setting").upsert({ key, value: next }, { onConflict: "key" });
    }
  } catch (e) {
    console.error(`[system-health] reportSubsystemHealth(${subsystem}) threw:`, e);
  }
}
