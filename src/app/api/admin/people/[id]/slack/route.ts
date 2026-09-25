import { withRole } from "@/lib/api";
import { getDb } from "@/lib/db";
import { reqString } from "@/lib/validate";

const UNIQUE_VIOLATION = "23505";

type Ctx = { params: Promise<{ id: string }> };

// Manually link/unlink a person's Slack user id. Complements the bulk
// email-based sync (syncSlackLinks) for people whose personal email doesn't
// match their Slack account. Admin-only.
/** Null = the person exists. Otherwise the response to bail out with — a read
 * failure is a 500, not the false 404 that swallowing `error` produced. */
async function personGate(db: ReturnType<typeof getDb>, id: string): Promise<Response | null> {
  const { data, error } = await db.from("person").select("id").eq("id", id).maybeSingle();
  if (error) {
    console.error("slack link: person lookup failed", error);
    return Response.json({ error: "failed" }, { status: 500 });
  }
  return data !== null ? null : Response.json({ error: "not_found" }, { status: 404 });
}

export const PUT = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const slackUserId = reqString(body?.slackUserId, 32);
  if (!slackUserId) return Response.json({ error: "invalid" }, { status: 400 });

  const db = getDb();
  const gate = await personGate(db, id);
  if (gate) return gate;

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
  const gate = await personGate(db, id);
  if (gate) return gate;

  const { error } = await db.from("person").update({ slack_user_id: null }).eq("id", id);
  if (error) return Response.json({ error: "failed" }, { status: 500 });
  return Response.json({ ok: true });
});
