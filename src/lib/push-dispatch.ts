// src/lib/push-dispatch.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { NotificationType } from "./notification-types";

export type PushPayload = { title: string; body: string; url: string };

type SendFn = typeof webpush.sendNotification;

export type PushDeps = {
  publicKey: string;
  privateKey: string;
  subject: string;
  send: SendFn;
} | null;

/** null (⇒ dispatch becomes a logged no-op) when keys are unset. */
export function pushDepsFromEnv(): PushDeps {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject, send: webpush.sendNotification };
}

/** Slack alert text carries mrkdwn (":emoji:", ```fenced``` raw errors) that is
 *  wrong for a lock screen. Strip both to plain text. */
export function sanitizePushText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks (incl. raw error dumps)
    .replace(/:[a-z0-9_+-]+:/gi, "") // emoji shortcodes
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const SEND_TIMEOUT_MS = 8000;

function isGone(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode;
  return code === 404 || code === 410;
}

/** Send one payload to every subscription owned by an opted-in person.
 *  `personIds` may be "all" for team-wide types. Never throws. */
export async function sendPushToOptedIn(
  personIds: string[] | "all",
  type: NotificationType,
  payload: PushPayload,
  deps: { db: SupabaseClient; push?: PushDeps },
): Promise<{ sent: number; pruned: number }> {
  const push = deps.push;
  if (!push) {
    console.log(`[push:unconfigured] would send ${type} to ${personIds === "all" ? "all" : personIds.length} person(s)`);
    return { sent: 0, pruned: 0 };
  }

  // Join push_subscription → person, keep only active persons opted into `type`.
  // person_id filter is skipped for "all".
  let query = deps.db
    .from("push_subscription")
    .select("id, endpoint, p256dh, auth, person!inner(id, is_active, notification_types)");
  query = personIds === "all"
    ? query.not("person_id", "is", null)
    : query.in("person_id", personIds);
  const { data, error } = await query;
  if (error) {
    console.error(`[push] load subscriptions failed for ${type}:`, error.message);
    return { sent: 0, pruned: 0 };
  }

  type Row = {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    person: { is_active: boolean; notification_types: string[] } | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.person?.is_active && r.person.notification_types.includes(type),
  );

  const body = JSON.stringify(payload);

  let sent = 0;
  let pruned = 0;
  await Promise.allSettled(
    rows.map(async (r) => {
      try {
        await push.send(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          body,
          {
            TTL: 3600,
            timeout: SEND_TIMEOUT_MS,
            vapidDetails: { subject: push.subject, publicKey: push.publicKey, privateKey: push.privateKey },
          },
        );
        sent += 1;
      } catch (err) {
        if (isGone(err)) {
          pruned += 1;
          await deps.db.from("push_subscription").delete().eq("id", r.id);
        } else {
          console.error(`[push] send failed for ${r.id}:`, (err as Error)?.message ?? err);
        }
      }
    }),
  );
  return { sent, pruned };
}
