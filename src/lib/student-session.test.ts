import { describe, expect, test } from "vitest";
import {
  createOtpSessionToken,
  createStudentSessionToken,
  verifyStudentSessionToken,
} from "./student-session";

const SECRET = "test-secret-at-least-32-characters-long!!";

describe("student session tokens", () => {
  test("round-trips a person id", async () => {
    const token = await createStudentSessionToken("person-123", SECRET);
    const result = await verifyStudentSessionToken(token, SECRET);
    expect(result).toEqual({ personId: "person-123" });
  });

  test("rejects a tampered token", async () => {
    const token = await createStudentSessionToken("person-123", SECRET);
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifyStudentSessionToken(tampered, SECRET)).toBeNull();
  });

  test("rejects a token signed with a different secret", async () => {
    const token = await createStudentSessionToken("person-123", "x".repeat(32));
    expect(await verifyStudentSessionToken(token, SECRET)).toBeNull();
  });

  test("also accepts an otp-kind token", async () => {
    const token = await createOtpSessionToken("person-456", SECRET);
    expect(await verifyStudentSessionToken(token, SECRET)).toEqual({
      personId: "person-456",
    });
  });
});
