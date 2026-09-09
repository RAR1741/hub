import type { SupabaseClient } from "@supabase/supabase-js";
import { pushTestBlocked } from "@/app/admin/push-test/gate";
import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import { isNotificationType, NOTIFICATION_META } from "@/lib/notification-types";
import { deliverToSubscriptions, pushDepsFromEnv, type PushDeps, type PushSubscriptionRow } from "@/lib/push-dispatch";
import type { Viewer } from "@/lib/viewer";

// Dev-only, admin-only: fires a real push to the CALLER'S OWN devices,
// ignoring notification_types opt-in, so a dev can see one land without
// seeding data. gate.ts keeps this unreachable on any real deployment.
// Inner handler exported for unit tests; db/push injectable.
export async function pushTestHandler(
  viewer: Viewer,
  request: Request,
  _ctx: unknown,
  db: SupabaseClient = getDb(),
  push: PushDeps = pushDepsFromEnv(),
): Promise<Response> {
  if (pushTestBlocked()) return new Response("Not found", { status: 404 });
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });

  const raw = (await request.json().catch(() => null)) as
    | { type?: unknown; title?: unknown; body?: unknown; url?: unknown }
    | null;
  const type = raw?.type;
  if (!isNotificationType(type)) return Response.json({ error: "invalid_type" }, { status: 400 });

  const payload = {
    title: (typeof raw?.title === "string" && raw.title.trim()) || NOTIFICATION_META[type].label,
    body: (typeof raw?.body === "string" && raw.body.trim()) || "Test notification",
    url: (typeof raw?.url === "string" && raw.url.trim()) || "/",
  };

  if (!push) return Response.json({ sent: 0, pruned: 0, unconfigured: true });

  const { data, error } = await db
    .from("push_subscription")
    .select("id, endpoint, p256dh, auth")
    .eq("person_id", viewer.person.id);
  if (error) return Response.json({ error: "load_failed" }, { status: 500 });

  const result = await deliverToSubscriptions((data ?? []) as PushSubscriptionRow[], JSON.stringify(payload), { db, push });
  return Response.json(result);
}

export const POST = withRole("admin", (viewer, request, ctx) => pushTestHandler(viewer, request, ctx));
