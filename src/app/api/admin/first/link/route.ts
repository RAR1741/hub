import { getDb } from "@/lib/db";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";

const UNIQUE_VIOLATION = "23505";

export async function PATCH(request: Request) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const personId = body?.personId;
  const firstPeopleId = body?.firstPeopleId;
  if (
    typeof personId !== "string" ||
    personId.length === 0 ||
    !(firstPeopleId === null || (Number.isInteger(firstPeopleId)))
  ) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const db = getDb();
  const { error } = await db.from("person").update({ first_people_id: firstPeopleId }).eq("id", personId);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return Response.json({ error: "already_linked" }, { status: 409 });
    }
    return Response.json({ error: "failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
