import { NextResponse } from "next/server";
import { cancelEventSignup, signUpForEvent } from "@/lib/event-signups";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { getViewer } from "@/lib/viewer";

type Ctx = { params: Promise<{ id: string }> };

const signupLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(request: Request, context: Ctx) {
  if (!signupLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await context.params;
  // person_id is ALWAYS the viewer's own id — never read from the body.
  const result = await signUpForEvent(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}

export async function DELETE(_request: Request, context: Ctx) {
  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await context.params;
  const result = await cancelEventSignup(id, viewer.person.id);
  return NextResponse.json({ ok: result.ok }, { status: result.status });
}
