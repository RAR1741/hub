import { describe, expect, test } from "vitest";
import { optInt, optString, reqString, reqUuid } from "./validate";

describe("reqString", () => {
  test("trims and accepts within max", () => {
    expect(reqString("  Ada ", 10)).toBe("Ada");
  });
  test.each([[""], ["   "], [null], [undefined], [42], ["x".repeat(11)]])(
    "rejects %j",
    (v) => expect(reqString(v, 10)).toBeNull(),
  );
});

describe("optString", () => {
  test("absent or blank becomes value:null", () => {
    expect(optString(undefined, 10)).toEqual({ value: null });
    expect(optString("   ", 10)).toEqual({ value: null });
  });
  test("valid string is trimmed", () => {
    expect(optString(" hi ", 10)).toEqual({ value: "hi" });
  });
  test("wrong type or too long is invalid (outer null)", () => {
    expect(optString(42, 10)).toBeNull();
    expect(optString("x".repeat(11), 10)).toBeNull();
  });
});

describe("reqUuid", () => {
  test("accepts a well-formed UUID", () => {
    expect(reqUuid("4dcaf7ed-ae99-4cff-ab92-dad9c9167a66")).toBe(
      "4dcaf7ed-ae99-4cff-ab92-dad9c9167a66",
    );
  });
  test.each([[""], ["not-a-uuid"], ["4dcaf7ed-ae99-4cff-ab92"], [null], [undefined], [42]])(
    "rejects %j",
    (v) => expect(reqUuid(v)).toBeNull(),
  );
});

describe("optInt", () => {
  test("absent becomes value:null", () => {
    expect(optInt(undefined, 2000, 2100)).toEqual({ value: null });
  });
  test("in-range integer accepted", () => {
    expect(optInt(2028, 2000, 2100)).toEqual({ value: 2028 });
  });
  test.each([[1999], [2101], [2028.5], ["2028"], [NaN]])("rejects %j", (v) =>
    expect(optInt(v, 2000, 2100)).toBeNull(),
  );
});
