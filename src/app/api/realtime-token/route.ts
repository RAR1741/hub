import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { getViewer } from "@/lib/viewer";
import { mintRealtimeToken } from "@/lib/realtime-token";

/**
 * Who a realtime token may be issued to, and the `sub` it should carry for log
 * attribution: a registered kiosk device, or any logged-in (non-guest) viewer.
 * Returns null when neither applies.
 */
async function tokenSubject(): Promise<string | null> {
  const kioskToken = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (await verifyKioskToken(kioskToken)) return "kiosk";
  const viewer = await getViewer();
  if (viewer.role === "guest") return null;
  return viewer.person ? `person:${viewer.person.id}` : "authenticated";
}

export async function GET() {
  const subject = await tokenSubject();
  if (!subject) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "realtime not configured" }, { status: 503 });
  }
  const { token, expiresAt } = mintRealtimeToken(secret, subject);
  return NextResponse.json(
    { token, expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
