import { NextResponse } from "next/server";
import { cancelEventSignup, signUpForEvent } from "@/lib/event-signups";
import { getEvent } from "@/lib/events";
import { submitEventSignupResponse } from "@/lib/form-responses";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { reqUuid } from "@/lib/validate";
import { getViewer } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

const signupLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(request: Request, context: Ctx) {
  if (!signupLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });

  const event = await getEvent(id);
  if (!event) return NextResponse.json({ ok: false }, { status: 404 });

  // person_id is ALWAYS the viewer's own id — never read from the body.
  if (event.formId) {
    const body = (await request.json().catch(() => null)) as { answers?: unknown } | null;
    const submitted = Array.isArray(body?.answers)
      ? (body!.answers as Array<{ fieldId?: unknown; values?: unknown }>).map((a) => ({
          fieldId: typeof a?.fieldId === "string" ? a.fieldId : "",
          values: Array.isArray(a?.values) ? (a.values as unknown[]).filter((v): v is string => typeof v === "string") : [],
        }))
      : [];
    const result = await submitEventSignupResponse(id, viewer.person.id, event.formId, submitted);
    return NextResponse.json({ ok: result.ok }, { status: result.status });
  }

  // No form attached: existing one-click boolean sign-up, unchanged.
  const result = await signUpForEvent(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}

export async function DELETE(request: Request, context: Ctx) {
  if (!signupLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const result = await cancelEventSignup(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}
