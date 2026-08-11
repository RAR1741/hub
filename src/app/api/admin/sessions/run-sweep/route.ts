import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";

// Manual trigger for the nightly sweep — useful for "close everyone out now"
// and for testing without waiting for cron.
export const POST = withRole("mentor", async () => {
  const { data, error } = await getDb().rpc("close_stale_sessions");
  if (error) return Response.json({ error: "failed" }, { status: 500 });
  return Response.json({ closed: data as number });
});
