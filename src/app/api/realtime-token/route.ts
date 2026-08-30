import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { getViewer } from "@/lib/viewer";
import { mintRealtimeToken } from "@/lib/realtime-token";

/** Registered kiosk cookie, or any logged-in (non-guest) viewer. */
async function authorized(): Promise<boolean> {
  const kioskToken = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (await verifyKioskToken(kioskToken)) return true;
  const viewer = await getViewer();
  return viewer.role !== "guest";
}

export async function GET() {
  if (!(await authorized())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "realtime not configured" }, { status: 503 });
  }
  const { token, expiresAt } = mintRealtimeToken(secret);
  return NextResponse.json(
    { token, expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
