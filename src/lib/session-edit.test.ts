import { describe, expect, test } from "vitest";
import { parseManualSession, parseSessionEdit } from "./session-edit";

describe("parseSessionEdit", () => {
  test("accepts closed edit", () => {
    expect(
      parseSessionEdit({
        timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T20:00:00Z",
        note: " late ", excludedFromTotals: true,
      }),
    ).toEqual({
      timeIn: "2026-09-01T18:00:00.000Z", timeOut: "2026-09-01T20:00:00.000Z",
      note: "late", excludedFromTotals: true,
    });
  });
  test("accepts open edit (null timeOut)", () => {
    const r = parseSessionEdit({ timeIn: "2026-09-01T18:00:00Z", excludedFromTotals: false });
    expect(r?.timeOut).toBeNull();
  });
  test.each([
    [{ timeIn: "nope", excludedFromTotals: false }],
    [{ timeIn: "2026-09-01T20:00:00Z", timeOut: "2026-09-01T18:00:00Z", excludedFromTotals: false }], // out before in
    [{ excludedFromTotals: false }],
    [null],
  ])("rejects %j", (b) => expect(parseSessionEdit(b)).toBeNull());
});

describe("parseManualSession", () => {
  test("requires personId and timeIn", () => {
    expect(parseManualSession({ personId: "p1", timeIn: "2026-09-01T18:00:00Z" })).toEqual({
      personId: "p1", timeIn: "2026-09-01T18:00:00.000Z", timeOut: null, note: null,
    });
  });
  test.each([[{ timeIn: "2026-09-01T18:00:00Z" }], [{ personId: "p1" }], [null]])(
    "rejects %j",
    (b) => expect(parseManualSession(b)).toBeNull(),
  );
});
