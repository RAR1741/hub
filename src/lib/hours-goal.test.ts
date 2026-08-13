import { describe, expect, test } from "vitest";
import { hoursGoalProgress } from "./hours-goal";

describe("hoursGoalProgress", () => {
  test("goal 0 means no goal set → null", () => {
    expect(hoursGoalProgress(47.5, 0)).toBeNull();
  });

  test("negative goal → null", () => {
    expect(hoursGoalProgress(47.5, -10)).toBeNull();
  });

  test("hours below goal", () => {
    expect(hoursGoalProgress(47.5, 70)).toEqual({ goal: 70, remaining: 22.5, pct: 68 });
  });

  test("hours equal to goal", () => {
    expect(hoursGoalProgress(70, 70)).toEqual({ goal: 70, remaining: 0, pct: 100 });
  });

  test("hours above goal clamps pct at 100 and remaining at 0", () => {
    expect(hoursGoalProgress(90, 70)).toEqual({ goal: 70, remaining: 0, pct: 100 });
  });
});
