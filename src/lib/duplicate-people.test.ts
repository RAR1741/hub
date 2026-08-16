import { describe, expect, test } from "vitest";
import { findDuplicateCandidates, type DupPerson } from "./duplicate-people";

describe("findDuplicateCandidates", () => {
  test("finds a typo-surname pair via raw similarity", () => {
    const people: DupPerson[] = [
      { id: "1", first_name: "Ada", last_name: "Lovelace" },
      { id: "2", first_name: "Ada", last_name: "Lovlace" },
    ];
    const result = findDuplicateCandidates(people);
    expect(result).toHaveLength(1);
    expect(result[0].a).toBe("1");
    expect(result[0].b).toBe("2");
    expect(result[0].score).toBeGreaterThanOrEqual(0.72);
  });

  test("finds same-last-name Nat/Nathan pair via prefix heuristic below threshold", () => {
    const people: DupPerson[] = [
      { id: "1", first_name: "Nat", last_name: "Smith" },
      { id: "2", first_name: "Nathaniel", last_name: "Smith" },
    ];
    // Raw similarity of "Nat Smith" vs "Nathaniel Smith" is well below 0.72.
    const result = findDuplicateCandidates(people);
    expect(result).toHaveLength(1);
    expect(result[0].a).toBe("1");
    expect(result[0].b).toBe("2");
    expect(result[0].score).toBe(0.85);
  });

  test("unrelated people produce no pair", () => {
    const people: DupPerson[] = [
      { id: "1", first_name: "Alice", last_name: "Anderson" },
      { id: "2", first_name: "Bob", last_name: "Baker" },
    ];
    expect(findDuplicateCandidates(people)).toEqual([]);
  });

  test("a list with one obvious dup returns exactly that pair", () => {
    const people: DupPerson[] = [
      { id: "1", first_name: "Alice", last_name: "Anderson" },
      { id: "2", first_name: "Bob", last_name: "Baker" },
      { id: "3", first_name: "Alice", last_name: "Andersen" },
      { id: "4", first_name: "Carol", last_name: "Clark" },
    ];
    const result = findDuplicateCandidates(people);
    expect(result).toHaveLength(1);
    expect(result[0].a).toBe("1");
    expect(result[0].b).toBe("3");
  });

  test("output is deterministically ordered by score desc, then by ids", () => {
    const people: DupPerson[] = [
      { id: "z1", first_name: "Nat", last_name: "Smith" },
      { id: "z2", first_name: "Nathaniel", last_name: "Smith" },
      { id: "a1", first_name: "Ada", last_name: "Lovelace" },
      { id: "a2", first_name: "Ada", last_name: "Lovlace" },
    ];
    const result = findDuplicateCandidates(people);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const inOrder =
        prev.score > curr.score ||
        (prev.score === curr.score &&
          (prev.a < curr.a || (prev.a === curr.a && prev.b <= curr.b)));
      expect(inOrder).toBe(true);
    }
    // a is always the lexicographically-smaller id, b the larger.
    for (const c of result) {
      expect(c.a < c.b).toBe(true);
    }
  });

  test("threshold option can be overridden", () => {
    const people: DupPerson[] = [
      { id: "1", first_name: "Ada", last_name: "Lovelace" },
      { id: "2", first_name: "Ada", last_name: "Lovlace" },
    ];
    expect(findDuplicateCandidates(people, { threshold: 0.99 })).toEqual([]);
  });
});
