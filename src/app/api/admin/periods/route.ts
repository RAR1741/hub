import { withRole } from "@/lib/api";
import { createPeriod, parsePeriodInput } from "@/lib/periods";

export const POST = withRole("admin", async (_viewer, request) => {
  const input = parsePeriodInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createPeriod(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
