import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { gmailCredentialsFromEnv, sendMail } from "@/lib/gmail";
import { renderEmail } from "@/lib/email-template";
import { formatOtpCode, generateOtpCode, hashOtpCode, OTP_TTL_MINUTES } from "@/lib/otp";
import { reqString } from "@/lib/validate";
import { clientIp, otpEmailLimiter, otpRequestLimiter } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!otpRequestLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = reqString(body?.email, 320)?.toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // Checked for every submitted email string, known or not, so this can't be
  // used as an enumeration oracle.
  if (!otpEmailLimiter.check(email)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  // Success is always 200 below, regardless of whether the email is known, to
  // avoid account enumeration (429/500 are unrelated to whether it's known).
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

    const { error: deleteError } = await db
      .from("login_otp")
      .delete()
      .eq("person_id", personRow.id)
      .is("consumed_at", null);
    if (deleteError) {
      console.error("otp delete failed", deleteError);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    const { error: insertError } = await db.from("login_otp").insert({
      person_id: personRow.id,
      code_hash: hashOtpCode(code),
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error("otp insert failed", insertError);
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[otp] code for ${email}: ${formatOtpCode(code)}`);
    }

    const credentials = gmailCredentialsFromEnv();
    if (credentials) {
      try {
        const { html, text } = renderEmail({
          heading: "Your sign-in code",
          paragraphs: [`Enter this code on the 1741 Hub sign-in page. It expires in ${OTP_TTL_MINUTES} minutes.`],
          code: formatOtpCode(code),
          footerNote: "If you didn't request this code, you can ignore this email.",
        });
        await sendMail({ fetch, credentials }, { to: email, subject: "Your 1741 Hub sign-in code", text, html });
      } catch (err) {
        console.error("otp email send failed", err);
      }
    } else {
      console.error("otp email not sent: Gmail credentials not configured");
    }
  }

  return NextResponse.json({ ok: true });
}
