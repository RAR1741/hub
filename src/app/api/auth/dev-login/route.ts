import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createStudentSessionToken,
  STUDENT_SESSION_COOKIE,
} from "@/lib/student-session";
import { clientUrl } from "@/lib/request-origin";

// ponytail: fixed seeded ids, not a general "impersonate anyone" tool — dev/e2e convenience only.
const SEEDED_MENTOR_ID = "00000000-0000-0000-0000-000000000009";
const SEEDED_ADMIN_ID = "00000000-0000-0000-0000-00000000000a";

export async function POST(request: Request) {
  // Never let this exist in prod, no matter what env vars are set otherwise.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
  const { searchParams } = new URL(request.url);
  const role = (body?.role ?? searchParams.get("role")) as string | null;

  let personId: string | null = null;
  if (role === "mentor") {
    personId = SEEDED_MENTOR_ID;
  } else if (role === "admin") {
    personId = SEEDED_ADMIN_ID;
  } else if (role === "student") {
    const { data: row } = await getDb()
      .from("person")
      .select("id")
      .eq("student_id_number", "1741")
      .eq("role", "student")
      .maybeSingle();
    personId = row?.id ?? null;
  } else {
    return NextResponse.json({ ok: false, error: "invalid role" }, { status: 400 });
  }

  if (!personId) {
    return NextResponse.json(
      { ok: false, error: `no seeded ${role} person found — is the DB seeded?` },
      { status: 404 },
    );
  }

  const token = await createStudentSessionToken(
    personId,
    process.env.STUDENT_SESSION_SECRET!,
  );
  const response = NextResponse.redirect(clientUrl(request, "/"), 302);
  response.cookies.set(STUDENT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // guaranteed non-production by the guard above
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
