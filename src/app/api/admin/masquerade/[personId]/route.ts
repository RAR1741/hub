import { withRole } from "@/lib/api";
import { startMasquerade, MASQUERADE_COOKIE } from "@/lib/masquerade";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ personId: string }> };

export const POST = withRole<Ctx>("admin", async (viewer, _request, context) => {
  const { personId: targetPersonId } = await context.params;

  if (!viewer.person?.id) {
    return NextResponse.json({ error: "admin_person_not_found" }, { status: 500 });
  }

  const result = await startMasquerade(viewer.person.id, targetPersonId);

  if (!result.ok) {
    return NextResponse.json({ error: "failed" }, { status: result.status });
  }

  const response = NextResponse.json(
    { ok: true, sessionId: result.sessionId },
    { status: 200 },
  );

  response.cookies.set(MASQUERADE_COOKIE, result.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 3600,
    path: "/",
  });

  return response;
});
