import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { optInt, optString, reqString } from "@/lib/validate";
import { accountRequestLimiter, clientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!accountRequestLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });

  const firstName = reqString(body.firstName, 80);
  const lastName = reqString(body.lastName, 80);
  const gradYear = optInt(body.gradYear, 2000, 2100);
  const email = optString(body.email, 254);
  if (!firstName || !lastName || !gradYear || !email) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { error } = await getDb().from("account_request").insert({
    first_name: firstName,
    last_name: lastName,
    grad_year: gradYear.value,
    // Lowercased to satisfy the account_request_email_lowercase constraint.
    email: email.value?.toLowerCase() ?? null,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
