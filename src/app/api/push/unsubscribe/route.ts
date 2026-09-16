import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";

export const POST = withRole("student", async (viewer, request) => {
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) return Response.json({ error: "missing_endpoint" }, { status: 400 });
  // Delete only the viewer's own row for this endpoint.
  await getDb()
    .from("push_subscription")
    .delete()
    .eq("person_id", viewer.person.id)
    .eq("endpoint", body.endpoint);
  return Response.json({ ok: true });
});
