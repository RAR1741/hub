import { describe, expect, it } from "vitest";
import { compareByName, sortByName } from "./name-sort";

describe("compareByName", () => {
  it("orders by first name", () => {
    expect(compareByName({ firstName: "Ada", lastName: "Z" }, { firstName: "Bob", lastName: "A" })).toBeLessThan(0);
  });

  it("falls back to last name when first names tie", () => {
    expect(compareByName({ firstName: "Sam", lastName: "Adams" }, { firstName: "Sam", lastName: "Baker" })).toBeLessThan(0);
  });

  it("is case-insensitive", () => {
    expect(compareByName({ firstName: "ada", lastName: "x" }, { firstName: "Ada", lastName: "x" })).toBe(0);
  });
});

describe("sortByName", () => {
  it("sorts by first name then last name without mutating the input", () => {
    const input = [
      { firstName: "Sam", lastName: "Baker" },
      { firstName: "Ada", lastName: "Yang" },
      { firstName: "Sam", lastName: "Adams" },
    ];
    const sorted = sortByName(input);
    expect(sorted.map((p) => `${p.firstName} ${p.lastName}`)).toEqual([
      "Ada Yang",
      "Sam Adams",
      "Sam Baker",
    ]);
    // original untouched
    expect(input[0]).toEqual({ firstName: "Sam", lastName: "Baker" });
  });
});
