import { describe, expect, test } from "vitest";
import { nameKey, normalizeFull, isPrefixMatch, nameSimilarity } from "./name-match";

describe("nameKey", () => {
  test("normalizes case and surrounding space, pipe-separated", () => {
    expect(nameKey("  Ada ", "Lovelace")).toBe("ada|lovelace");
  });
});

describe("normalizeFull", () => {
  test("collapses internal whitespace and lowercases", () => {
    expect(normalizeFull("  Ada   B  Lovelace ")).toBe("ada b lovelace");
  });
});

describe("isPrefixMatch", () => {
  test("true when one name is a prefix of the other", () => {
    expect(isPrefixMatch("Nat", "Nathan")).toBe(true);
    expect(isPrefixMatch("Nathan", "nat")).toBe(true);
  });
  test("false for unrelated names and for empty", () => {
    expect(isPrefixMatch("Bob", "Alice")).toBe(false);
    expect(isPrefixMatch("", "Alice")).toBe(false);
  });
});

describe("nameSimilarity", () => {
  test("identical full names score 1", () => {
    expect(nameSimilarity("Ada", "Lovelace", "ada", " lovelace ")).toBe(1);
  });
  test("one-typo surname scores high (> 0.8)", () => {
    expect(nameSimilarity("Ada", "Lovelace", "Ada", "Lovlace")).toBeGreaterThan(0.8);
  });
  test("unrelated names score low (< 0.4)", () => {
    expect(nameSimilarity("Ada", "Lovelace", "Bob", "Zimmerman")).toBeLessThan(0.4);
  });
});
