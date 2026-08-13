import { NextResponse } from "next/server";
import { createExcusalRequest, parseExcusalRequestInput } from "@/lib/excusal-requests";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { getViewer } from "@/lib/viewer";

const excusalRequestLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!excusalRequestLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const viewer = await getViewer();
  if (!viewer.person) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const input = parseExcusalRequestInput(body);
  if (!input) return NextResponse.json({ ok: false }, { status: 400 });

  // person_id is ALWAYS the viewer's own id — never read from the body.
  const result = await createExcusalRequest(viewer.person.id, input);
  if (!result.ok) return NextResponse.json({ ok: false }, { status: result.status });
  return NextResponse.json({ ok: true }, { status: result.status });
}
