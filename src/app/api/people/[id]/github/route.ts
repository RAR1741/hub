import { NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// Self-or-admin only, and does NOT call GitHub — the person surfaces in
// `wouldRemove` on the next reconcile; an admin removes them from the linked
// team (which fires the real removal hook) if that's intended.
export async function DELETE(request: Request, context: Ctx) {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });

  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin") && viewer.person?.id !== id) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const db = getDb();
  const { error } = await db
    .from("person")
    .update({ github_login: null, github_user_id: null })
    .eq("id", id);
  if (error) return NextResponse.json({ ok: false }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
