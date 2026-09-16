import { withRole } from "@/lib/api";
import { displayName, listPeople } from "@/lib/people";

export const GET = withRole("mentor", async (_viewer, request) => {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!q) return Response.json({ people: [] });

  const rows = await listPeople(q);
  const people = [...rows]
    .sort((a, b) => Number(b.is_active) - Number(a.is_active))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      name: displayName(p),
      role: p.role,
      isActive: p.is_active,
      gradYear: p.grad_year,
    }));
  return Response.json({ people });
});
