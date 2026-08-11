import { withRole } from "@/lib/api";
import { createKioskDevice } from "@/lib/kiosk";
import { reqString } from "@/lib/validate";

export const POST = withRole("admin", async (viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = reqString(body?.name, 80);
  if (!name) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createKioskDevice(name, viewer.person!.id);
  if (!result) return Response.json({ error: "failed" }, { status: 500 });
  // The plaintext token is returned ONCE; only its hash is stored.
  return Response.json({ id: result.id, token: result.token }, { status: 201 });
});
