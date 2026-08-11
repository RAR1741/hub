import { describe, expect, test } from "vitest";
import { parseApproval } from "./requests";

describe("parseApproval", () => {
  test("accepts student ID with default role student", () => {
    expect(parseApproval({ studentIdNumber: " 1742 " })).toEqual({
      studentIdNumber: "1742",
      role: "student",
    });
  });
  test("accepts captain", () => {
    expect(parseApproval({ studentIdNumber: "17", role: "captain" })).toEqual({
      studentIdNumber: "17",
      role: "captain",
    });
  });
  test.each([
    [{}],
    [{ studentIdNumber: "" }],
    [{ studentIdNumber: "ok", role: "admin" }],
    [{ studentIdNumber: "x".repeat(65) }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseApproval(body)).toBeNull();
  });
});
