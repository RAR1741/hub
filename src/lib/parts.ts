import type { SupabaseClient } from "@supabase/supabase-js";
import type { Part, PartPriority, PartRow, PartStatus, Project, ProjectRow } from "./types";
import { PART_STATUSES, partFromRow, projectFromRow } from "./types";
import { optString, reqString, reqUuid } from "./validate";

const PREFIX_RE = /^[A-Za-z0-9]{1,20}$/;

export type ProjectInput = {
  name: string;
  partNumberPrefix: string;
};

/** Validate a project payload. PURE. Null = invalid. */
export function parseProjectInput(body: unknown): ProjectInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 80);
  if (!name) return null;
  if (typeof b.partNumberPrefix !== "string" || !PREFIX_RE.test(b.partNumberPrefix)) return null;
  return { name, partNumberPrefix: b.partNumberPrefix.toUpperCase() };
}

export type PartInput = {
  projectId: string;
  type: "part" | "assembly";
  name: string;
  parentPartId: string | null;
};

/** Validate a part-creation payload. PURE. Null = invalid. */
export function parsePartInput(body: unknown): PartInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const projectId = reqUuid(b.projectId);
  const name = reqString(b.name, 120);
  if (!projectId || !name) return null;
  if (b.type !== "part" && b.type !== "assembly") return null;
  // Parts must belong to an assembly (see nextPartNumber): a loose top-level
  // part and the first child of assembly #0 would both compute part_number 1
  // and permanently collide. Assemblies may still be top-level or nested.
  if (b.type === "part") {
    const id = reqUuid(b.parentPartId);
    if (!id) return null;
    return { projectId, type: "part", name, parentPartId: id };
  }
  let parentPartId: string | null = null;
  if (b.parentPartId !== undefined && b.parentPartId !== null) {
    const id = reqUuid(b.parentPartId);
    if (!id) return null;
    parentPartId = id;
  }
  return { projectId, type: "assembly", name, parentPartId };
}

export type PartPatch = Partial<{
  name: string;
  status: PartStatus;
  priority: PartPriority;
  notes: string | null;
  sourceMaterial: string | null;
  quantity: string | null;
  cutLength: string | null;
  haveMaterial: boolean;
  drawingCreated: boolean;
}>;

/**
 * Validate a partial part-update payload. PURE. Returns only the fields
 * present in `body`; null when the body has no recognized field, or any
 * provided field is invalid. Immutable fields (projectId, parentPartId,
 * partNumber, type) aren't part of this type — they're silently ignored if
 * present in `body`, since PATCH callers only ever send the editable subset.
 */
export function parsePartPatch(body: unknown): PartPatch | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: PartPatch = {};
  let any = false;

  if ("name" in b) {
    const name = reqString(b.name, 120);
    if (!name) return null;
    patch.name = name;
    any = true;
  }
  if ("status" in b) {
    if (typeof b.status !== "string" || !(PART_STATUSES as readonly string[]).includes(b.status)) return null;
    patch.status = b.status as PartStatus;
    any = true;
  }
  if ("priority" in b) {
    if (b.priority !== 0 && b.priority !== 1 && b.priority !== 2) return null;
    patch.priority = b.priority;
    any = true;
  }
  if ("notes" in b) {
    const notes = optString(b.notes, 2000);
    if (!notes) return null;
    patch.notes = notes.value;
    any = true;
  }
  if ("sourceMaterial" in b) {
    const sourceMaterial = optString(b.sourceMaterial, 200);
    if (!sourceMaterial) return null;
    patch.sourceMaterial = sourceMaterial.value;
    any = true;
  }
  if ("quantity" in b) {
    const quantity = optString(b.quantity, 50);
    if (!quantity) return null;
    patch.quantity = quantity.value;
    any = true;
  }
  if ("cutLength" in b) {
    const cutLength = optString(b.cutLength, 50);
    if (!cutLength) return null;
    patch.cutLength = cutLength.value;
    any = true;
  }
  if ("haveMaterial" in b) {
    if (typeof b.haveMaterial !== "boolean") return null;
    patch.haveMaterial = b.haveMaterial;
    any = true;
  }
  if ("drawingCreated" in b) {
    if (typeof b.drawingCreated !== "boolean") return null;
    patch.drawingCreated = b.drawingCreated;
    any = true;
  }

  return any ? patch : null;
}

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

function mapWriteError(code: string | undefined): number {
  if (code === FOREIGN_KEY_VIOLATION) return 400;
  if (code === UNIQUE_VIOLATION) return 409;
  return 500;
}

// ---- Projects ----

export async function createProject(
  input: ProjectInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("project")
    .insert({ name: input.name, part_number_prefix: input.partNumberPrefix })
    .select("id")
    .single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true, id: data.id as string };
}

export async function listProjects(db?: SupabaseClient): Promise<Project[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("project").select("*").order("name", { ascending: true });
  return ((data ?? []) as ProjectRow[]).map(projectFromRow);
}

export async function getProject(id: string, db?: SupabaseClient): Promise<Project | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("project").select("*").eq("id", id).maybeSingle();
  return data ? projectFromRow(data as ProjectRow) : null;
}

export async function updateProject(
  id: string,
  input: ProjectInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("project")
    .update({ name: input.name, part_number_prefix: input.partNumberPrefix })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Refuses (409) when the project still has parts; the FK (restrict) is the backstop. */
export async function deleteProject(id: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("project").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { data: parts } = await client.from("part").select("id").eq("project_id", id).limit(1);
  if (parts && parts.length > 0) return { ok: false, status: 409 };
  const { error } = await client.from("project").delete().eq("id", id);
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 409 : 500 };
  return { ok: true, status: 200 };
}

// ---- Parts ----

/** Port of cheesy-parts `Part.generate_number_and_create`. See design doc §2. */
async function nextPartNumber(
  input: PartInput,
  client: SupabaseClient,
): Promise<{ ok: true; number: number } | { ok: false; status: number }> {
  if (input.type === "assembly") {
    const { data } = await client
      .from("part")
      .select("part_number")
      .eq("project_id", input.projectId)
      .eq("type", "assembly")
      .order("part_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const max = (data as { part_number: number } | null)?.part_number;
    return { ok: true, number: (max ?? -1000) + 1000 };
  }

  // Parts always have a parent assembly (enforced by parsePartInput / the
  // parent validation in createPart), so this is always an .eq(), never the
  // top-level/.is(null) branch — that's what keeps a part's number seeded
  // from its parent's block instead of colliding with the top of the range.
  const { data: sibling } = await client
    .from("part")
    .select("part_number")
    .eq("project_id", input.projectId)
    .eq("type", "part")
    .eq("parent_part_id", input.parentPartId)
    .order("part_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const siblingMax = (sibling as { part_number: number } | null)?.part_number;
  if (siblingMax !== undefined && siblingMax !== null) return { ok: true, number: siblingMax + 1 };

  const { data: parent } = await client
    .from("part")
    .select("part_number, project_id, type")
    .eq("id", input.parentPartId)
    .maybeSingle();
  const parentRow = parent as { part_number: number; project_id: string; type: string } | null;
  if (!parentRow || parentRow.project_id !== input.projectId || parentRow.type !== "assembly") {
    return { ok: false, status: 400 };
  }
  return { ok: true, number: parentRow.part_number + 1 };
}

/**
 * Numbering + insert are not transactional (matches cheesy). On a
 * unique-violation (23505) — two concurrent creates picked the same number —
 * recompute and retry once; a second collision gives up with 409.
 */
export async function createPart(
  input: PartInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string; partNumber: number } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();

  if (input.parentPartId) {
    const { data: parent } = await client
      .from("part")
      .select("project_id, type")
      .eq("id", input.parentPartId)
      .maybeSingle();
    const parentRow = parent as { project_id: string; type: string } | null;
    if (!parentRow || parentRow.project_id !== input.projectId || parentRow.type !== "assembly") {
      return { ok: false, status: 400 };
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const numbered = await nextPartNumber(input, client);
    if (!numbered.ok) return numbered;
    const { data, error } = await client
      .from("part")
      .insert({
        project_id: input.projectId,
        parent_part_id: input.parentPartId,
        part_number: numbered.number,
        type: input.type,
        name: input.name,
      })
      .select("id")
      .single();
    if (!error) return { ok: true, id: data.id as string, partNumber: numbered.number };
    if (error.code !== UNIQUE_VIOLATION) return { ok: false, status: mapWriteError(error.code) };
    // retry once on 23505; fall through to loop
  }
  return { ok: false, status: 409 };
}

export async function listParts(projectId: string, db?: SupabaseClient): Promise<Part[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("part").select("*").eq("project_id", projectId);
  return ((data ?? []) as PartRow[]).map(partFromRow);
}

/** Part count per project, one query for the whole table (avoids an N+1 of `listParts` per project). */
export async function countPartsByProject(db?: SupabaseClient): Promise<Record<string, number>> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("part").select("project_id");
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { project_id: string }[]) {
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
  }
  return counts;
}

export async function getPart(id: string, db?: SupabaseClient): Promise<Part | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("part").select("*").eq("id", id).maybeSingle();
  return data ? partFromRow(data as PartRow) : null;
}

const PATCH_COLUMNS: Record<keyof PartPatch, string> = {
  name: "name",
  status: "status",
  priority: "priority",
  notes: "notes",
  sourceMaterial: "source_material",
  quantity: "quantity",
  cutLength: "cut_length",
  haveMaterial: "have_material",
  drawingCreated: "drawing_created",
};

export async function updatePart(
  id: string,
  patch: PartPatch,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof PartPatch)[]) {
    row[PATCH_COLUMNS[key]] = patch[key];
  }
  const { data, error } = await client.from("part").update(row).eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Refuses (409) when the part (an assembly) still has children; the FK (restrict) is the backstop. */
export async function deletePart(id: string, db?: SupabaseClient): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("part").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { data: children } = await client.from("part").select("id").eq("parent_part_id", id).limit(1);
  if (children && children.length > 0) return { ok: false, status: 409 };
  const { error } = await client.from("part").delete().eq("id", id);
  if (error) return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 409 : 500 };
  return { ok: true, status: 200 };
}

// ---- Pure helpers ----

/**
 * Breadcrumb chain from a top ancestor down to (but not including) `part`,
 * built in-memory from an already-fetched `listParts` array — no recursive
 * SQL. Top-level parts (no parent) return an empty array.
 */
export function partAncestors(part: Part, all: Part[]): Part[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  const chain: Part[] = [];
  let parentId = part.parentPartId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parentPartId;
  }
  return chain;
}

export type PartSortKey = "number" | "type" | "name" | "parent" | "status";

/** Ascending sort by key, computed in-memory (a project holds hundreds of rows at most). */
export function sortParts(parts: Part[], key: PartSortKey): Part[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const compare = (a: Part, b: Part): number => {
    switch (key) {
      case "number":
        return a.partNumber - b.partNumber;
      case "type":
        return a.type.localeCompare(b.type);
      case "name":
        return a.name.localeCompare(b.name);
      case "parent": {
        const aParent = a.parentPartId ? (byId.get(a.parentPartId)?.name ?? "") : "";
        const bParent = b.parentPartId ? (byId.get(b.parentPartId)?.name ?? "") : "";
        return aParent.localeCompare(bParent);
      }
      case "status":
        return PART_STATUSES.indexOf(a.status) - PART_STATUSES.indexOf(b.status);
      default:
        return 0;
    }
  };
  return [...parts].sort(compare);
}
