import { withRole } from "@/lib/api";
import { parsePeriodInput, setActivePeriod, updatePeriod } from "@/lib/periods";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  // { action: "activate" } activates; otherwise it's a field update.
  if (body?.action === "activate") {
    const result = await setActivePeriod(id);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  const input = parsePeriodInput(body);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updatePeriod(id, input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
