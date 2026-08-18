import { withRole } from "@/lib/api";
import { listGcalCandidates } from "@/lib/events";

export const GET = withRole("mentor", async () => {
  const candidates = await listGcalCandidates();
  return Response.json({ candidates });
});
