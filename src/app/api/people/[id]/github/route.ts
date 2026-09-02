import { NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { reqUuid, reqString, optInt } from "@/lib/validate";
import { withRole } from "@/lib/api";
import { syncPersonLinkedTeams } from "@/lib/github-team-sync";

type Ctx = { params: Promise<{ id: string }> };

// Admin-only manual alternative to the OAuth "Connect GitHub" flow — e.g. to
// hand-link a "would remove" reconcile entry to a hub person. Persists both
// columns (the numeric id is authoritative; the reconcile diff keys on it).
export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const personId = reqUuid(id);
  if (!personId) return Response.json({ error: "invalid" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const githubLogin = reqString(body?.githubLogin, 39);
  const githubUserId = optInt(body?.githubUserId, 1, Number.MAX_SAFE_INTEGER);
  if (!githubLogin || !githubUserId || githubUserId.value === null) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const db = getDb();
  const { error } = await db
    .from("person")
    .update({ github_login: githubLogin, github_user_id: githubUserId.value })
    .eq("id", personId);
  if (error) {
    return Response.json(
      { error: error.code === "23505" ? "taken" : "failed" },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  await syncPersonLinkedTeams(personId, db);
  return Response.json({ ok: true });
});

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
