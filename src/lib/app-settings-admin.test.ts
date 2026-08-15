import { describe, expect, test } from "vitest";
import { parseSettingsInput } from "./app-settings-admin";

describe("parseSettingsInput", () => {
  test("accepts a valid payload (empty calendar id allowed)", () => {
    expect(
      parseSettingsInput({
        teamTimezone: "America/Indiana/Indianapolis",
        gcalCalendarId: "",
        autoCloseEnabled: true,
        autoCloseHours: 4,
        maxShiftHours: 18,
        seasonHoursGoal: 70,
      }),
    ).toEqual({
      teamTimezone: "America/Indiana/Indianapolis",
      gcalCalendarId: "",
      autoCloseEnabled: true,
      autoCloseHours: 4,
      maxShiftHours: 18,
      seasonHoursGoal: 70,
    });
  });
  test("preserves autoCloseEnabled: false", () => {
    expect(
      parseSettingsInput({
        teamTimezone: "UTC",
        gcalCalendarId: "",
        autoCloseEnabled: false,
        autoCloseHours: 4,
        maxShiftHours: 18,
        seasonHoursGoal: 70,
      })?.autoCloseEnabled,
    ).toBe(false);
  });
  test("accepts seasonHoursGoal of 0 (no goal set)", () => {
    expect(
      parseSettingsInput({
        teamTimezone: "UTC",
        gcalCalendarId: "",
        autoCloseEnabled: true,
        autoCloseHours: 4,
        maxShiftHours: 18,
        seasonHoursGoal: 0,
      }),
    ).not.toBeNull();
  });
  test.each([
    [{ teamTimezone: "Not/AZone", gcalCalendarId: "", autoCloseEnabled: true, autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseEnabled: true, autoCloseHours: 0, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseEnabled: true, autoCloseHours: 4, maxShiftHours: 99, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "x".repeat(201), autoCloseEnabled: true, autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseEnabled: true, autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: -1 }],
    // Missing/non-boolean autoCloseEnabled is rejected.
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseEnabled: "yes", autoCloseHours: 4, maxShiftHours: 18, seasonHoursGoal: 70 }],
    [{ teamTimezone: "UTC", gcalCalendarId: "", autoCloseEnabled: true, autoCloseHours: 4, maxShiftHours: 18 }],
    [null],
  ])("rejects %j", (b) => expect(parseSettingsInput(b)).toBeNull());
});
