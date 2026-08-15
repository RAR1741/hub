import { getViewer } from "@/lib/viewer";

export async function GET() {
  const viewer = await getViewer();
  return Response.json({
    role: viewer.role,
    name: viewer.person
      ? `${viewer.person.firstName} ${viewer.person.lastName}`
      : null,
  });
}
