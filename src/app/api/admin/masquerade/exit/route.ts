import { getViewer } from "@/lib/viewer";
import { endMasquerade, MASQUERADE_COOKIE } from "@/lib/masquerade";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const viewer = await getViewer();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(MASQUERADE_COOKIE)?.value;

  // Even if viewer.masquerade is not set (DB session already ended, or stale cookie),
  // try to end the session by cookie ID. Always clear the cookie to unlock the user.
  if (sessionId) {
    await endMasquerade(sessionId);
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.delete(MASQUERADE_COOKIE);
  return response;
}
