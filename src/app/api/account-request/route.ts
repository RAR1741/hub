import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    gradYear?: number;
    email?: string;
  } | null;

  const firstName = body?.firstName?.trim();
  const lastName = body?.lastName?.trim();
  if (!firstName || !lastName) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { error } = await getDb().from("account_request").insert({
    first_name: firstName,
    last_name: lastName,
    grad_year: body?.gradYear ?? null,
    email: body?.email?.trim() || null,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
