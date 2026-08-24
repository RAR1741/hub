import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { evaluateOtpVerify, hashOtpCode, normalizeOtpCode } from "@/lib/otp";
import { createOtpSessionToken, STUDENT_SESSION_COOKIE } from "@/lib/student-session";
import { reqString } from "@/lib/validate";
import { clientIp, otpVerifyLimiter } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!otpVerifyLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; code?: unknown }
    | null;
  const email = reqString(body?.email, 320)?.toLowerCase();
  const code = typeof body?.code === "string" ? normalizeOtpCode(body.code) : null;
  if (!email || !code) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const db = getDb();
  const { data: identity, error: identityError } = await db
    .from("person_identity")
    .select("person_id, person (id, is_active)")
    .eq("email", email)
    .maybeSingle();
  const person = (
    identity as { person: { id: string; is_active: boolean } | { id: string; is_active: boolean }[] | null } | null
  )?.person;
  const personRow = Array.isArray(person) ? person[0] : person;
  if (identityError || !personRow?.is_active) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { data: otpRow, error: otpError } = await db
    .from("login_otp")
    .select("id, code_hash, attempts")
    .eq("person_id", personRow.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpError || !otpRow) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const decision = evaluateOtpVerify(otpRow, hashOtpCode(code));
  if (decision === "blocked") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Persisted regardless of match, so aborted/failed guesses still count.
  // Compare-and-swap on attempts: if a concurrent request already bumped it,
  // this row won't match and we lose the race (401) instead of both requests
  // proceeding past the 5-attempt cap.
  const { data: attemptRow, error: attemptError } = await db
    .from("login_otp")
    .update({ attempts: otpRow.attempts + 1 })
    .eq("id", otpRow.id)
    .eq("attempts", otpRow.attempts)
    .select("id");
  if (attemptError || !attemptRow?.length) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (decision === "mismatch") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Single-winner consumption: only the request that flips consumed_at from
  // null wins and gets a session; a concurrent duplicate loses the race.
  const { data: consumeRow, error: consumeError } = await db
    .from("login_otp")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", otpRow.id)
    .is("consumed_at", null)
    .select("id");
  if (consumeError || !consumeRow?.length) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = await createOtpSessionToken(personRow.id, process.env.STUDENT_SESSION_SECRET!);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STUDENT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
