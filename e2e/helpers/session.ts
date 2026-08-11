import {
  STUDENT_SESSION_COOKIE,
  createStudentSessionToken,
} from "../../src/lib/student-session";

export const SEEDED_MENTOR_ID = "00000000-0000-0000-0000-000000000009";
export const SEEDED_STUDENT_ID_NUMBER = "1741";

/**
 * A Playwright cookie for a real mentor session. Mints a student-session app-JWT
 * for the seeded mentor's person id; resolveViewer reads the role (mentor) off
 * the person row, so this yields a mentor viewer without OAuth.
 */
export async function mentorSessionCookie(
  baseURL = "http://localhost:3000",
): Promise<{ name: string; value: string; url: string }> {
  const secret = process.env.STUDENT_SESSION_SECRET;
  if (!secret) throw new Error("STUDENT_SESSION_SECRET must be set for E2E");
  const value = await createStudentSessionToken(SEEDED_MENTOR_ID, secret);
  return { name: STUDENT_SESSION_COOKIE, value, url: baseURL };
}
