import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { getViewer } from "@/lib/viewer";

const ISSUER = "hub-realtime";
const TTL_SECONDS = 60 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Mints an HS256 JWT authorizing the private `hub:*` realtime channels. */
export function mintRealtimeToken(
  secret: string,
  now: () => number = Date.now,
): { token: string; expiresAt: number } {
  const iat = Math.floor(now() / 1000);
  const exp = iat + TTL_SECONDS;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ role: "authenticated", iss: ISSUER, iat, exp }));
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return { token: `${signingInput}.${signature}`, expiresAt: exp * 1000 };
}

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
