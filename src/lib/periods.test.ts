import { describe, expect, test } from "vitest";
import { parsePeriodInput } from "./periods";

describe("parsePeriodInput", () => {
  test("accepts a valid period", () => {
    expect(
      parsePeriodInput({ name: " Fall ", startsOn: "2026-08-01", endsOn: "2026-12-31" }),
    ).toEqual({ name: "Fall", startsOn: "2026-08-01", endsOn: "2026-12-31" });
  });
  test.each([
    [{ name: "", startsOn: "2026-08-01", endsOn: "2026-12-31" }],
    [{ name: "X", startsOn: "not-a-date", endsOn: "2026-12-31" }],
    [{ name: "X", startsOn: "2026-08-01", endsOn: "2026-07-01" }], // end before start
    [{ name: "X", startsOn: "2026-08-01" }],                        // missing end
    [null],
  ])("rejects %j", (body) => {
    expect(parsePeriodInput(body)).toBeNull();
  });
});
