import { withRole } from "@/lib/api";
import { createPerson, parsePersonInput } from "@/lib/people";

export const POST = withRole("admin", async (_viewer, request) => {
  const body = await request.json().catch(() => null);
  const input = parsePersonInput(body);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createPerson(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
