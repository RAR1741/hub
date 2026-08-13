import { describe, expect, test } from "vitest";
import { parseApproval } from "./requests";

describe("parseApproval", () => {
  test("accepts student ID with default role student", () => {
    expect(parseApproval({ studentIdNumber: " 1742 " })).toEqual({
      studentIdNumber: "1742",
      role: "student",
    });
  });
  test.each([
    [{}],
    [{ studentIdNumber: "" }],
    [{ studentIdNumber: "ok", role: "admin" }],
    [{ studentIdNumber: "ok", role: "captain" }], // captain role removed — no longer approvable
    [{ studentIdNumber: "x".repeat(65) }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseApproval(body)).toBeNull();
  });
});
