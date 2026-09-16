import type { SupabaseClient } from "@supabase/supabase-js";
import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import { NOTIFICATION_META, isNotificationType } from "@/lib/notification-types";
import { parseReminderMinutes } from "@/lib/reminder-minutes";
import type { Viewer } from "@/lib/viewer";

export async function prefsHandler(
  viewer: Viewer,
  request: Request,
  _ctx: unknown,
  db: SupabaseClient = getDb(),
): Promise<Response> {
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as
    | { type?: unknown; enabled?: unknown; meetingReminderMinutes?: unknown }
    | null;

  if (body && "meetingReminderMinutes" in body) {
    const minutes = parseReminderMinutes(body.meetingReminderMinutes);
    if (minutes === null) return Response.json({ error: "invalid_minutes" }, { status: 400 });
    const { error } = await db
      .from("person")
      .update({ meeting_reminder_minutes: minutes })
      .eq("id", viewer.person.id);
    if (error) return Response.json({ error: "store_failed" }, { status: 500 });
    return Response.json({ ok: true, meetingReminderMinutes: minutes });
  }

  const type = body?.type;
  const enabled = body?.enabled === true;
  if (!isNotificationType(type)) return Response.json({ error: "unknown_type" }, { status: 400 });
  if (!NOTIFICATION_META[type].roles.includes(viewer.role)) {
    return Response.json({ error: "forbidden_type" }, { status: 403 });
  }
  // Recompute the array from the viewer's current set (source of truth = DB row,
  // but viewer.person carries it; re-read to avoid a lost update is overkill for
  // a single-user toggle). Read current, add/remove, write.
  const current = new Set((viewer.person as { notification_types?: string[] }).notification_types ?? []);
  if (enabled) current.add(type);
  else current.delete(type);
  const { error } = await db
    .from("person")
    .update({ notification_types: [...current] })
    .eq("id", viewer.person.id);
  if (error) return Response.json({ error: "store_failed" }, { status: 500 });
  return Response.json({ ok: true, notification_types: [...current] });
}

export const PATCH = withRole("student", (viewer, request, ctx) => prefsHandler(viewer, request, ctx));
