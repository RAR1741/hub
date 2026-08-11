import { describe, expect, test } from "vitest";
import { buildTeamTree, parseTeamInput } from "./teams";
import type { Team } from "./types";

const team = (id: string, name: string, parentTeamId: string | null): Team => ({
  id, name, parentTeamId, description: null, joinMode: "admin_only",
});

describe("buildTeamTree", () => {
  test("nests children under parents, sorted by name", () => {
    const tree = buildTeamTree([
      team("root", "Red Alert", null),
      team("m", "Mechanical", "root"),
      team("p", "Programming", "root"),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.name)).toEqual(["Mechanical", "Programming"]);
  });

  test("orphaned parent ids surface as roots", () => {
    const tree = buildTeamTree([team("a", "A", "missing")]);
    expect(tree.map((t) => t.id)).toEqual(["a"]);
  });

  test("multiple roots sorted by name", () => {
    const tree = buildTeamTree([team("b", "Bravo", null), team("a", "Alpha", null)]);
    expect(tree.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("parseTeamInput", () => {
  test("accepts valid input", () => {
    expect(
      parseTeamInput({ name: " Pit Crew ", joinMode: "open" }),
    ).toEqual({ name: "Pit Crew", parentTeamId: null, description: null, joinMode: "open" });
  });
  test.each([
    [{ name: "", joinMode: "open" }],
    [{ name: "X", joinMode: "sneaky" }],
    [{ name: "X", joinMode: "open", parentTeamId: 42 }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseTeamInput(body)).toBeNull();
  });
});
