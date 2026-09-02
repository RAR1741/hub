import { withRole } from "@/lib/api";
import { addTeamExternalAccount, removeTeamExternalAccount, type Provider } from "@/lib/team-external-accounts";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

function reqProvider(v: unknown): Provider | null {
  return v === "google" || v === "github" ? v : null;
}

export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const provider = reqProvider(body?.provider);
  const identifier = reqString(body?.identifier, 254);
  const label = reqString(body?.label, 80);
  if (!provider || !identifier || !label) return Response.json({ error: "invalid" }, { status: 400 });

  const result = await addTeamExternalAccount(id, { provider, identifier, label });
  if (!result.ok) {
    if (result.status === 404) {
      return Response.json({ error: "github_user_not_found" }, { status: 404 });
    }
    return Response.json({ error: "failed" }, { status: result.status });
  }
  return Response.json({ ok: true, row: result.row });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const provider = reqProvider(body?.provider);
  const identifier = reqString(body?.identifier, 254);
  if (!provider || !identifier) return Response.json({ error: "invalid" }, { status: 400 });

  const result = await removeTeamExternalAccount(id, provider, identifier);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
