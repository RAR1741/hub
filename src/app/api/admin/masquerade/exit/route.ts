import { getViewer } from "@/lib/viewer";
import { endMasquerade, MASQUERADE_COOKIE } from "@/lib/masquerade";
import { NextResponse } from "next/server";

export async function POST() {
  const viewer = await getViewer();

  if (!viewer.masquerade) {
    return NextResponse.json(
      { error: "not_masquerading" },
      { status: 400 },
    );
  }

  const result = await endMasquerade(viewer.masquerade.sessionId);

  if (!result.ok) {
    return NextResponse.json({ error: "failed" }, { status: result.status });
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.delete(MASQUERADE_COOKIE);

  return response;
}
