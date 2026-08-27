import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import { reqString } from "@/lib/validate";

const UNIQUE_VIOLATION = "23505";

type Ctx = { params: Promise<{ id: string }> };

// Manually link/unlink a person's Slack user id. Complements the bulk
// email-based sync (syncSlackLinks) for people whose personal email doesn't
// match their Slack account. Admin-only.
async function personExists(db: ReturnType<typeof getDb>, id: string): Promise<boolean> {
  const { data } = await db.from("person").select("id").eq("id", id).maybeSingle();
  return data !== null;
}

export const PUT = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const slackUserId = reqString(body?.slackUserId, 32);
  if (!slackUserId) return Response.json({ error: "invalid" }, { status: 400 });

  const db = getDb();
  if (!(await personExists(db, id))) return Response.json({ error: "not_found" }, { status: 404 });

  const { error } = await db.from("person").update({ slack_user_id: slackUserId }).eq("id", id);
  if (error) {
    return Response.json(
      { error: error.code === UNIQUE_VIOLATION ? "slack_id_taken" : "failed" },
      { status: error.code === UNIQUE_VIOLATION ? 409 : 500 },
    );
  }
  return Response.json({ ok: true });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const db = getDb();
  if (!(await personExists(db, id))) return Response.json({ error: "not_found" }, { status: 404 });

  const { error } = await db.from("person").update({ slack_user_id: null }).eq("id", id);
  if (error) return Response.json({ error: "failed" }, { status: 500 });
  return Response.json({ ok: true });
});
