import { NextResponse } from "next/server";
import { kioskActionAllowed } from "@/lib/kiosk";
import { clockOut } from "@/lib/sessions";
import { reqString } from "@/lib/validate";
import { createRateLimiter, clientIp } from "@/lib/rate-limit";
import { broadcast } from "@/lib/realtime";

const clockLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!clockLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  if (!(await kioskActionAllowed(request))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { personId?: unknown } | null;
  const personId = reqString(body?.personId, 64);
  if (!personId) return NextResponse.json({ ok: false }, { status: 400 });
  const result = await clockOut(personId);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  await broadcast("hub:presence", "clock-out");
  return NextResponse.json({ ok: true });
}
