import { describe, expect, test } from "vitest";
import { resolveParentPartId } from "./onshape-panel-form";

const assemblies = [{ id: "a1" }, { id: "a2" }];

describe("resolveParentPartId", () => {
  test("returns current when it is a valid assembly", () => {
    expect(resolveParentPartId(assemblies, "a2", "part")).toBe("a2");
  });

  test("part type with no/stale selection auto-selects the first assembly", () => {
    expect(resolveParentPartId(assemblies, "", "part")).toBe("a1");
    expect(resolveParentPartId(assemblies, "stale-id", "part")).toBe("a1");
  });

  test("part type with no assemblies returns empty", () => {
    expect(resolveParentPartId([], "", "part")).toBe("");
  });

  test("assembly type with invalid/empty current returns top level", () => {
    expect(resolveParentPartId(assemblies, "", "assembly")).toBe("");
    expect(resolveParentPartId(assemblies, "stale-id", "assembly")).toBe("");
  });

  test("assembly type preserves a valid current selection", () => {
    expect(resolveParentPartId(assemblies, "a1", "assembly")).toBe("a1");
  });
});
