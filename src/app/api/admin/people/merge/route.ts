import { withRole } from "@/lib/api";
import { mergePeople } from "@/lib/merge-people";
import { reqString } from "@/lib/validate";

export const POST = withRole("admin", async (_viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const winnerId = reqString(body?.winnerId, 64);
  const loserId = reqString(body?.loserId, 64);
  if (!winnerId || !loserId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await mergePeople(winnerId, loserId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
