import type { SupabaseClient } from "@supabase/supabase-js";
import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import type { Viewer } from "@/lib/viewer";

// Inner handler exported for unit tests; db injectable.
export async function subscribeHandler(
  viewer: Viewer,
  request: Request,
  _ctx: unknown,
  db: SupabaseClient = getDb(),
): Promise<Response> {
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !endpoint.startsWith("https://") || !p256dh || !auth) {
    return Response.json({ error: "invalid_subscription" }, { status: 400 });
  }
  const { error } = await db.from("push_subscription").upsert(
    {
      person_id: viewer.person.id,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get("user-agent"),
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return Response.json({ error: "store_failed" }, { status: 500 });
  return Response.json({ ok: true });
}

export const POST = withRole("student", (viewer, request, ctx) => subscribeHandler(viewer, request, ctx));
