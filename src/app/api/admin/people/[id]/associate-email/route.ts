import { withRole } from "@/lib/api";
import { setPersonEmail } from "@/lib/people";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// Claim an unrecognized email (e.g. one surfaced by the Drive-sync report) for
// an existing person. Admin-only. 409 means the email already belongs to
// someone else; the client turns that into a human-readable message.
export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = reqString(body?.email, 254);
  if (!email) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await setPersonEmail(id, email);
  if (!result.ok) {
    return Response.json(
      { error: result.status === 409 ? "email_taken" : "failed" },
      { status: result.status },
    );
  }
  return Response.json({ ok: true });
});
