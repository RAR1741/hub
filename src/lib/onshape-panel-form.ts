/**
 * Resolves the Parent-assembly `<select>` value for the Onshape panel's
 * Add-Part form. Pure so the controlled-select/state drift (a phantom
 * selection where the browser renders the first assembly but React state
 * stays "") can be unit-tested without mounting the component.
 */
export function resolveParentPartId(
  assemblies: { id: string }[],
  current: string,
  type: "part" | "assembly",
): string {
  if (assemblies.some((a) => a.id === current)) return current;
  if (type === "part") return assemblies[0]?.id ?? "";
  return "";
}
