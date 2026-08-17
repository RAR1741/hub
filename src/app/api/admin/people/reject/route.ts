import { withRole } from "@/lib/api";
import { rejectPair, unrejectPair } from "@/lib/merge-people";
import { reqString } from "@/lib/validate";

function parseIds(body: Record<string, unknown> | null) {
  const aId = reqString(body?.aId, 64);
  const bId = reqString(body?.bId, 64);
  if (!aId || !bId || aId === bId) return null;
  return { aId, bId };
}

export const POST = withRole("admin", async (viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = parseIds(body);
  if (!ids) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await rejectPair(ids.aId, ids.bId, viewer.person!.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole("admin", async (_viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = parseIds(body);
  if (!ids) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await unrejectPair(ids.aId, ids.bId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
