import { SignJWT, jwtVerify } from "jose";

export const STUDENT_SESSION_COOKIE = "hub_student_session";
const SESSION_DURATION = "7d";

export async function createStudentSessionToken(
  personId: string,
  secret: string,
): Promise<string> {
  return new SignJWT({ sub: personId, kind: "student" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(new TextEncoder().encode(secret));
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
    if (payload.kind !== "student" || typeof payload.sub !== "string") {
      return null;
    }
    return { personId: payload.sub };
  } catch {
    return null;
  }
}
