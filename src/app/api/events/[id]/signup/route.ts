import { NextResponse } from "next/server";
import { masqueradeReadOnly } from "@/lib/api";
import { cancelEventSignup, signUpForEvent } from "@/lib/event-signups";
import { getEvent } from "@/lib/events";
import { submitEventSignupResponse } from "@/lib/form-responses";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { parseReminderMinutes } from "@/lib/reminder-minutes";
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
  const blocked = masqueradeReadOnly(viewer);
  if (blocked) return blocked;
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });

  const event = await getEvent(id);
  if (!event) return NextResponse.json({ ok: false }, { status: 404 });

  // Body is optional on the one-click path (no body sent at all).
  const body = await request.json().catch(() => ({}));
  const minutes = parseReminderMinutes((body as { reminderMinutes?: unknown })?.reminderMinutes);
  if (minutes === null) {
    return NextResponse.json({ ok: false, error: "invalid reminderMinutes" }, { status: 400 });
  }

  // person_id is ALWAYS the viewer's own id — never read from the body.
  if (event.formId) {
    const answers = (body as { answers?: unknown })?.answers;
    const submitted = Array.isArray(answers)
      ? (answers as Array<{ fieldId?: unknown; values?: unknown }>).map((a) => ({
          fieldId: typeof a?.fieldId === "string" ? a.fieldId : "",
          values: Array.isArray(a?.values) ? (a.values as unknown[]).filter((v): v is string => typeof v === "string") : [],
        }))
      : [];
    const result = await submitEventSignupResponse(id, viewer.person.id, event.formId, submitted, undefined, undefined, minutes);
    return NextResponse.json({ ok: result.ok }, { status: result.status });
  }

  // No form attached: existing one-click boolean sign-up, unchanged.
  const result = await signUpForEvent(id, viewer.person.id, undefined, undefined, minutes);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}

export async function DELETE(request: Request, context: Ctx) {
  if (!signupLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });
  const blocked = masqueradeReadOnly(viewer);
  if (blocked) return blocked;
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const result = await cancelEventSignup(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}
