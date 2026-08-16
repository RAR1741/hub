import { withRole } from "@/lib/api";
import { addPersonEmail } from "@/lib/identities";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

// Add a sign-in email to a person (their first becomes primary). Also used
// by the Drive-sync report to claim an unrecognized group email. Admin-only.
export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = reqString(body?.email, 254);
  if (!email) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await addPersonEmail(id, email);
  if (!result.ok) {
    return Response.json(
      { error: result.status === 409 ? "email_taken" : "failed" },
      { status: result.status },
    );
  }
  return Response.json({ ok: true });
});
