import {
  STUDENT_SESSION_COOKIE,
  createStudentSessionToken,
} from "../../src/lib/student-session";
import { seededStudentPersonId } from "./db";

export const SEEDED_MENTOR_ID = "00000000-0000-0000-0000-000000000009";
export const SEEDED_ADMIN_ID = "00000000-0000-0000-0000-00000000000a";
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

/**
 * Same as mentorSessionCookie, but for the seeded admin — needed for E2E specs
 * that exercise admin-gated routes (meetings, periods, people, kiosk devices).
 */
export async function adminSessionCookie(
  baseURL = "http://localhost:3000",
): Promise<{ name: string; value: string; url: string }> {
  const secret = process.env.STUDENT_SESSION_SECRET;
  if (!secret) throw new Error("STUDENT_SESSION_SECRET must be set for E2E");
  const value = await createStudentSessionToken(SEEDED_ADMIN_ID, secret);
  return { name: STUDENT_SESSION_COOKIE, value, url: baseURL };
}

/**
 * A session cookie for the seeded student (student_id_number 1741) — used by
 * specs that need to act as that student (e.g. POSTing their own excusal
 * requests) without driving the /login form.
 */
export async function studentSessionCookie(
  baseURL = "http://localhost:3000",
): Promise<{ name: string; value: string; url: string }> {
  const secret = process.env.STUDENT_SESSION_SECRET;
  if (!secret) throw new Error("STUDENT_SESSION_SECRET must be set for E2E");
  const personId = await seededStudentPersonId();
  const value = await createStudentSessionToken(personId, secret);
  return { name: STUDENT_SESSION_COOKIE, value, url: baseURL };
}
