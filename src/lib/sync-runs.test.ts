import { describe, expect, test } from "vitest";
import { parseSyncRunFilter } from "./sync-runs";

describe("parseSyncRunFilter", () => {
  test("accepts a full valid filter", () => {
    expect(
      parseSyncRunFilter({
        source: "calendar_sync",
        ok: "true",
        from: "2026-01-01",
        to: "2026-01-31",
        page: "2",
      }),
    ).toEqual({
      source: "calendar_sync",
      ok: true,
      from: "2026-01-01",
      to: "2026-01-31",
      page: 2,
    });
  });

  test("defaults to page 1 with no other filters", () => {
    expect(parseSyncRunFilter({})).toEqual({ page: 1 });
  });

  test("takes the first element when a param is an array", () => {
    expect(parseSyncRunFilter({ source: ["github_sync", "slack_sync"], page: ["3", "4"] })).toEqual({
      source: "github_sync",
      page: 3,
    });
  });

  test("drops an unknown source", () => {
    expect(parseSyncRunFilter({ source: "not_a_source" })).toEqual({ page: 1 });
  });

  test("drops ok when not true/false", () => {
    expect(parseSyncRunFilter({ ok: "yes" })).toEqual({ page: 1 });
    expect(parseSyncRunFilter({ ok: "false" })).toEqual({ page: 1, ok: false });
  });

  test.each([["2026-1-1"], ["not-a-date"], [""]])("drops malformed date %j", (d) => {
    expect(parseSyncRunFilter({ from: d, to: d })).toEqual({ page: 1 });
  });

  test.each([["2026-01-32"], ["2026-13-01"]])("drops invalid calendar date %j", (d) => {
    expect(parseSyncRunFilter({ from: d, to: d })).toEqual({ page: 1 });
  });

  test.each([["0"], ["-1"], ["1.5"], ["abc"], [undefined]])("clamps invalid page %j to 1", (p) => {
    expect(parseSyncRunFilter({ page: p as string | undefined })).toEqual({ page: 1 });
  });

  test("falls back to page 1 for an absurdly large page", () => {
    expect(parseSyncRunFilter({ page: "99999999999999" })).toEqual({ page: 1 });
  });
});
