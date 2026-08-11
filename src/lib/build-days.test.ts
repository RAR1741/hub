import { describe, expect, test } from "vitest";
import { parseBuildDayInput, parseBuildDayKind } from "./build-days";

describe("parseBuildDayInput", () => {
  test("accepts a valid required day", () => {
    expect(parseBuildDayInput({ date: "2026-09-01", kind: "required" })).toEqual({
      date: "2026-09-01", kind: "required",
    });
  });
  test("accepts optional", () => {
    expect(parseBuildDayInput({ date: "2026-09-01", kind: "optional" })?.kind).toBe("optional");
  });
  test.each([
    [{ date: "nope", kind: "required" }],
    [{ date: "2026-09-01", kind: "sometimes" }],
    [{ date: "2026-09-01" }],
    [{ kind: "required" }],
    [null],
  ])("rejects %j", (b) => expect(parseBuildDayInput(b)).toBeNull());
});

describe("parseBuildDayKind", () => {
  test("accepts kind", () => {
    expect(parseBuildDayKind({ kind: "optional" })).toBe("optional");
  });
  test.each([[{ kind: "nope" }], [{}], [null]])("rejects %j", (b) =>
    expect(parseBuildDayKind(b)).toBeNull(),
  );
});
