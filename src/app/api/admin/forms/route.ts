import { withRole } from "@/lib/api";
import { createForm, listForms, parseFormInput } from "@/lib/forms";

export const GET = withRole("mentor", async () => {
  return Response.json({ forms: await listForms() });
});

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseFormInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createForm(input, viewer.person!.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
