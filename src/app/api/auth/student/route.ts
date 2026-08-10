import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createStudentSessionToken,
  STUDENT_SESSION_COOKIE,
} from "@/lib/student-session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    studentId?: string;
  } | null;
  const studentId = body?.studentId?.trim();
  if (!studentId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { data: row } = await getDb()
    .from("person")
    .select("id, is_active")
    .eq("student_id_number", studentId)
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
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
