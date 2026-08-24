import { withRole } from "@/lib/api";
import { searchGuardians } from "@/lib/guardians";

export const GET = withRole("admin", async (_viewer, request) => {
  const { searchParams } = new URL(request.url);
  const guardians = await searchGuardians(searchParams.get("q") ?? "");
  return Response.json({ guardians });
});
