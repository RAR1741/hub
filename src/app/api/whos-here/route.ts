import { getViewer } from "@/lib/viewer";
import { listWhosHere } from "@/lib/sessions";

export async function GET() {
  // Open to any viewer including guests (names only — same scope as the roster).
  await getViewer();
  const here = await listWhosHere();
  return Response.json({ here: here.map((h) => ({ name: h.name, since: h.since })) });
}
