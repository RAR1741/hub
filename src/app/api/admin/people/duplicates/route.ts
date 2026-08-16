import { withRole } from "@/lib/api";
import { listDuplicateCandidates } from "@/lib/merge-people";

export const GET = withRole("admin", async () => {
  const pairs = await listDuplicateCandidates();
  return Response.json({ pairs });
});
