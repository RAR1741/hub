import { describe, expect, test } from "vitest";
import { parseSettingsInput } from "./app-settings-admin";

describe("parseSettingsInput", () => {
  test("accepts a valid payload (empty calendar id allowed)", () => {
    expect(
      parseSettingsInput({
        teamTimezone: "America/Indiana/Indianapolis",
        gcalCalendarId: "",
        autoCloseHours: 4,
        maxShiftHours: 18,
      }),
    ).toEqual({
      teamTimezone: "America/Indiana/Indianapolis",
      gcalCalendarId: "",
      autoCloseHours: 4,
      maxShiftHours: 18,
    });
  });
  test.each([
    [{ teamTimezone: "Not/AZone", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 18 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 0, maxShiftHours: 18 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 99 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "x".repeat(201), autoCloseHours: 4, maxShiftHours: 18 }],
    [null],
  ])("rejects %j", (b) => expect(parseSettingsInput(b)).toBeNull());
});
