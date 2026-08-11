import { NextResponse } from "next/server";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { createRateLimiter, clientIp } from "@/lib/rate-limit";

const setupLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!setupLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || !(await verifyKioskToken(token))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // a year — this is a fixed shop tablet
    path: "/",
  });
  return response;
}
