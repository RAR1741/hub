import { NextResponse } from "next/server";
import { STUDENT_SESSION_COOKIE } from "@/lib/student-session";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.delete(STUDENT_SESSION_COOKIE);
  // Supabase auth cookies are cleared client-side via supabase.auth.signOut()
  // on the login page; belt-and-suspenders: expire any sb-* cookies present.
  for (const cookie of request.headers.get("cookie")?.split("; ") ?? []) {
    const name = cookie.split("=")[0];
    if (name.startsWith("sb-")) response.cookies.delete(name);
  }
  return response;
}
