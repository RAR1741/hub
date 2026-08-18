import { withRole } from "@/lib/api";
import { listGcalCandidates } from "@/lib/events";
import { reqUuid } from "@/lib/validate";

export const GET = withRole("mentor", async (_viewer, request) => {
  const excludeEventId = reqUuid(new URL(request.url).searchParams.get("excludeEventId")) ?? undefined;
  const candidates = await listGcalCandidates(undefined, excludeEventId);
  return Response.json({ candidates });
});
