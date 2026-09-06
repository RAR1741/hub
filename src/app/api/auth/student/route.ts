import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createStudentSessionToken,
  STUDENT_SESSION_COOKIE,
} from "@/lib/student-session";
import { reqString } from "@/lib/validate";
import { clientIp, studentLoginLimiter } from "@/lib/rate-limit";

export async function POST(request: Request) {
  // Student-ID login is a single-factor, low-entropy credential. Disabled in
  // production (email OTP / Google are the prod paths) but kept for dev/e2e
  // convenience; we may reintroduce a hardened version later. See issue #251.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (!studentLoginLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    studentId?: unknown;
  } | null;
  const studentId = reqString(body?.studentId, 64);
  if (!studentId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { data: row } = await getDb()
    .from("person")
    .select("id, is_active, role")
    .eq("student_id_number", studentId)
    // ID login is for students only (spec §3.3); staff sign in with Google.
    .eq("role", "student")
    .maybeSingle();

  if (!row || !row.is_active) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = await createStudentSessionToken(
    row.id,
    process.env.STUDENT_SESSION_SECRET!,
  );
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STUDENT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // guaranteed non-production by the guard above
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
