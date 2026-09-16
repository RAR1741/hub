import { withRole } from "@/lib/api";
import { createBattery, parseBatteryInput } from "@/lib/batteries";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseBatteryInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createBattery(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
