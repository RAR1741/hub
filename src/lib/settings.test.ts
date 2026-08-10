import { describe, expect, test } from "vitest";
import { getSetting } from "./settings";

function fakeDb(row: { value: unknown } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as never;
}

describe("getSetting", () => {
  test("returns stored value", async () => {
    const db = fakeDb({ value: "America/Indiana/Indianapolis" });
    expect(await getSetting("team_timezone", "UTC", db)).toBe(
      "America/Indiana/Indianapolis",
    );
  });

  test("returns fallback when key missing", async () => {
    expect(await getSetting("team_timezone", "UTC", fakeDb(null))).toBe("UTC");
  });
});
