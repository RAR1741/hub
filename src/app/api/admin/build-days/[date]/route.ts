import { withRole } from "@/lib/api";
import { deleteBuildDay, parseBuildDayKind, setBuildDayKind } from "@/lib/build-days";

type Ctx = { params: Promise<{ date: string }> };

export const PATCH = withRole<Ctx>("mentor", async (_viewer, request, context) => {
  const { date } = await context.params;
  const kind = parseBuildDayKind(await request.json().catch(() => null));
  if (!kind) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await setBuildDayKind(date, kind);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { date } = await context.params;
  const result = await deleteBuildDay(date);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
