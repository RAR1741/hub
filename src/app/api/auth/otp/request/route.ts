import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { gmailCredentialsFromEnv, sendMail } from "@/lib/gmail";
import { formatOtpCode, generateOtpCode, hashOtpCode, OTP_TTL_MINUTES } from "@/lib/otp";
import { reqString } from "@/lib/validate";
import { clientIp, otpRequestLimiter } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!otpRequestLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = reqString(body?.email, 320)?.toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Always 200 below, regardless of whether the email is known, to avoid
  // account enumeration.
  const db = getDb();
  const { data: identity, error } = await db
    .from("person_identity")
    .select("person_id, person (id, is_active)")
    .eq("email", email)
    .maybeSingle();
  const person = (
    identity as { person: { id: string; is_active: boolean } | { id: string; is_active: boolean }[] | null } | null
  )?.person;
  const personRow = Array.isArray(person) ? person[0] : person;

  if (!error && personRow?.is_active) {
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

    await db.from("login_otp").delete().eq("person_id", personRow.id).is("consumed_at", null);
    await db.from("login_otp").insert({
      person_id: personRow.id,
      code_hash: hashOtpCode(code),
      expires_at: expiresAt,
    });

    if (process.env.NODE_ENV !== "production") {
      console.log(`[otp] code for ${email}: ${formatOtpCode(code)}`);
    }

    const credentials = gmailCredentialsFromEnv();
    if (credentials) {
      try {
        await sendMail(
          { fetch, credentials },
          {
            to: email,
            subject: "Your 1741 Hub sign-in code",
            text: `Your sign-in code is ${formatOtpCode(code)}. It expires in ${OTP_TTL_MINUTES} minutes.`,
          },
        );
      } catch (err) {
        console.error("otp email send failed", err);
      }
    } else {
      console.error("otp email not sent: Gmail credentials not configured");
    }
  }

  return NextResponse.json({ ok: true });
}
