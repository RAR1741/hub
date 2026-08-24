import { withRole } from "@/lib/api";
import { createPart, parsePartInput } from "@/lib/parts";

export const POST = withRole("student", async (_viewer, request) => {
  const input = parsePartInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createPart(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id, partNumber: result.partNumber }, { status: 201 });
});
