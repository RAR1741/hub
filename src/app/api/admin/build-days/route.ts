import { withRole } from "@/lib/api";
import { createManualBuildDay, parseBuildDayInput } from "@/lib/build-days";

export const POST = withRole("mentor", async (_viewer, request) => {
  const input = parseBuildDayInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createManualBuildDay(input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});
