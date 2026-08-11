/** Required trimmed string, 1..max chars. Returns null when missing/invalid. */
export function reqString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > max) return null;
  return s;
}

/**
 * Optional trimmed string. Outer null = present but invalid (wrong type / too long).
 * { value: null } = absent or blank (treat as "not provided").
 */
export function optString(
  v: unknown,
  max: number,
): { value: string | null } | null {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0) return { value: null };
  if (s.length > max) return null;
  return { value: s };
}

/** Optional integer within [min, max]. Same outer-null convention as optString. */
export function optInt(
  v: unknown,
  min: number,
  max: number,
): { value: number | null } | null {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < min || v > max) return null;
  return { value: v };
}
