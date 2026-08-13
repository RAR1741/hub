import { describe, expect, test } from "vitest";
import { secureEqual } from "./secure-compare";

describe("secureEqual", () => {
  test("true for identical strings", () => {
    expect(secureEqual("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });
  test("false for different strings of equal length", () => {
    expect(secureEqual("aaaaaa", "aaaaab")).toBe(false);
  });
  test("false for different-length strings (no length-based throw)", () => {
    expect(secureEqual("short", "muchlonger-secret")).toBe(false);
  });
  test("false when one side is empty", () => {
    expect(secureEqual("", "nonempty")).toBe(false);
    expect(secureEqual("nonempty", "")).toBe(false);
  });
  test("true for two empty strings", () => {
    expect(secureEqual("", "")).toBe(true);
  });
});
