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
        seasonHoursGoal: 70,
      }),
    ).toEqual({
      teamTimezone: "America/Indiana/Indianapolis",
      gcalCalendarId: "",
      autoCloseHours: 4,
      maxShiftHours: 18,
      seasonHoursGoal: 70,
    });
  });
  test("accepts seasonHoursGoal of 0 (no goal set)", () => {
    expect(
      parseSettingsInput({
        teamTimezone: "UTC",
        gcalCalendarId: "",
        autoCloseHours: 4,
        maxShiftHours: 18,
        seasonHoursGoal: 0,
      }),
    ).not.toBeNull();
  });
  test.each([
    [{ teamTimezone: "Not/AZone", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 0, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 99, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "x".repeat(201), autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: -1 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 18 }],
    [null],
  ])("rejects %j", (b) => expect(parseSettingsInput(b)).toBeNull());
});
