import { describe, expect, test } from "vitest";
import { parseExcusalInput } from "./excusals";

describe("parseExcusalInput", () => {
  test("accepts a valid excusal with a note", () => {
    expect(parseExcusalInput({ personId: "p1", date: "2026-09-01", note: " sick " })).toEqual({
      personId: "p1", date: "2026-09-01", note: "sick",
    });
  });
  test("note is optional (absent → null)", () => {
    expect(parseExcusalInput({ personId: "p1", date: "2026-09-01" })).toEqual({
      personId: "p1", date: "2026-09-01", note: null,
    });
  });
  test.each([
    [{ personId: "p1", date: "nope" }],
    [{ date: "2026-09-01" }],
    [{ personId: "p1" }],
    [null],
  ])("rejects %j", (b) => expect(parseExcusalInput(b)).toBeNull());
});
