import { describe, expect, test } from "vitest";
import { ancestorIds, subtreeIds, type TeamLink } from "./team-tree";

describe("ancestorIds", () => {
  const cases: { name: string; teams: TeamLink[]; teamId: string; expected: string[] }[] = [
    {
      name: "linear chain returns nearest ancestor first",
      teams: [
        { id: "grandparent", parentTeamId: null },
        { id: "parent", parentTeamId: "grandparent" },
        { id: "child", parentTeamId: "parent" },
      ],
      teamId: "child",
      expected: ["parent", "grandparent"],
    },
    {
      name: "root has no ancestors",
      teams: [{ id: "root", parentTeamId: null }],
      teamId: "root",
      expected: [],
    },
    {
      name: "unknown id returns empty",
      teams: [{ id: "root", parentTeamId: null }],
      teamId: "ghost",
      expected: [],
    },
    {
      name: "orphan parent (missing team) stops the walk",
      teams: [{ id: "child", parentTeamId: "missing-parent" }],
      teamId: "child",
      expected: [],
    },
    {
      name: "self-parenting cycle terminates",
      teams: [{ id: "a", parentTeamId: "a" }],
      teamId: "a",
      expected: [],
    },
    {
      name: "A -> B -> A cycle terminates, each id once",
      teams: [
        { id: "a", parentTeamId: "b" },
        { id: "b", parentTeamId: "a" },
      ],
      teamId: "a",
      expected: ["b"],
    },
    {
      name: "wide tree returns only the path to root, not siblings",
      teams: [
        { id: "root", parentTeamId: null },
        { id: "left", parentTeamId: "root" },
        { id: "right", parentTeamId: "root" },
        { id: "left-child", parentTeamId: "left" },
        { id: "right-child", parentTeamId: "right" },
      ],
      teamId: "left-child",
      expected: ["left", "root"],
    },
  ];

  for (const { name, teams, teamId, expected } of cases) {
    test(name, () => {
      expect(ancestorIds(teams, teamId)).toEqual(expected);
    });
  }
});

describe("subtreeIds", () => {
  const cases: { name: string; teams: TeamLink[]; teamId: string; expected: string[] }[] = [
    {
      name: "leaf returns just itself",
      teams: [
        { id: "root", parentTeamId: null },
        { id: "leaf", parentTeamId: "root" },
      ],
      teamId: "leaf",
      expected: ["leaf"],
    },
    {
      name: "root of a 3-level tree returns all ids once, BFS order",
      teams: [
        { id: "root", parentTeamId: null },
        { id: "child-a", parentTeamId: "root" },
        { id: "child-b", parentTeamId: "root" },
        { id: "grandchild", parentTeamId: "child-a" },
      ],
      teamId: "root",
      expected: ["root", "child-a", "child-b", "grandchild"],
    },
    {
      name: "unknown id returns just itself",
      teams: [{ id: "root", parentTeamId: null }],
      teamId: "ghost",
      expected: ["ghost"],
    },
    {
      name: "self-parenting cycle terminates, id once",
      teams: [{ id: "a", parentTeamId: "a" }],
      teamId: "a",
      expected: ["a"],
    },
    {
      name: "A -> B -> A cycle terminates, each id once",
      teams: [
        { id: "a", parentTeamId: "b" },
        { id: "b", parentTeamId: "a" },
      ],
      teamId: "a",
      expected: ["a", "b"],
    },
  ];

  for (const { name, teams, teamId, expected } of cases) {
    test(name, () => {
      expect(subtreeIds(teams, teamId)).toEqual(expected);
    });
  }
});
