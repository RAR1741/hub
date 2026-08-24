import { SignJWT, jwtVerify } from "jose";

export const STUDENT_SESSION_COOKIE = "hub_student_session";
const SESSION_DURATION = "7d";

async function signSessionToken(
  personId: string,
  kind: "student" | "otp",
  secret: string,
): Promise<string> {
  return new SignJWT({ sub: personId, kind })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(new TextEncoder().encode(secret));
}

export function createStudentSessionToken(
  personId: string,
  secret: string,
): Promise<string> {
  return signSessionToken(personId, "student", secret);
}

/** Same cookie/claims shape as the student-ID session, minted after OTP verification. */
export function createOtpSessionToken(
  personId: string,
  secret: string,
): Promise<string> {
  return signSessionToken(personId, "otp", secret);
}

export async function verifyStudentSessionToken(
  token: string,
  secret: string,
): Promise<{ personId: string } | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    if (
      (payload.kind !== "student" && payload.kind !== "otp") ||
      typeof payload.sub !== "string"
    ) {
      return null;
    }
    return { personId: payload.sub };
  } catch {
    return null;
  }
}
