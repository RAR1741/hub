import { withRole } from "@/lib/api";
import { discardOnshapeToken, getConnection, listElementParts } from "@/lib/onshape";
import { findPartsByOnshapeIdentity, listAssembliesByProject, listProjects } from "@/lib/parts";
import { fullPartNumber } from "@/lib/types";

/**
 * Panel context (spec §3/§4 task 4). Onshape passes the CAD selection
 * context as query params (some unsubstituted -> literal `{$...}` tokens,
 * hence `discardOnshapeToken` on every one).
 */
export const GET = withRole("student", async (viewer, request) => {
  const url = new URL(request.url);
  const param = (key: string) => discardOnshapeToken(url.searchParams.get(key) ?? undefined);
  const documentId = param("documentId");
  const workspaceOrVersion = param("workspaceOrVersion");
  const workspaceOrVersionId = param("workspaceOrVersionId");
  const elementId = param("elementId");
  const server = param("server");

  if (
    !documentId ||
    !workspaceOrVersionId ||
    !elementId ||
    (workspaceOrVersion !== "w" && workspaceOrVersion !== "v" && workspaceOrVersion !== "m")
  ) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  // Onshape reloads this panel on every CAD selection change, so the
  // project/assembly payload is built only once we know it will be used — the
  // non-connected states don't render it — and then in batched queries rather
  // than one per project / per CAD part.
  const personId = viewer.person!.id;
  const connection = await getConnection(personId);
  if (!connection) {
    return Response.json({ connectionState: "needs_connect", parts: [], projects: [] });
  }

  const result = await listElementParts(personId, {
    documentId,
    wvm: workspaceOrVersion,
    wvmId: workspaceOrVersionId,
    elementId,
    server,
  });
  if ("needsReconnect" in result) {
    return Response.json({ connectionState: "needs_reconnect", parts: [], projects: [] });
  }
  if ("error" in result) {
    return Response.json({ connectionState: "fetch_failed", parts: [], projects: [] });
  }

  const [rawProjects, assembliesByProject, hubByOnshapePartId] = await Promise.all([
    listProjects(),
    listAssembliesByProject(),
    findPartsByOnshapeIdentity(
      documentId,
      elementId,
      result.parts.map((p) => p.partId),
    ),
  ]);
  const prefixByProjectId = new Map(rawProjects.map((p) => [p.id, p.partNumberPrefix]));

  const projects = rawProjects.map((p) => ({
    id: p.id,
    name: p.name,
    assemblies: (assembliesByProject[p.id] ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      fullPartNumber: fullPartNumber(p.partNumberPrefix, a.type, a.partNumber),
    })),
  }));

  const parts = result.parts.map((p) => {
    const hub = hubByOnshapePartId.get(p.partId);
    return {
      partId: p.partId,
      name: p.name,
      material: p.material,
      onshapePartNumber: p.onshapePartNumber,
      hubPart: hub
        ? {
            id: hub.id,
            fullPartNumber: fullPartNumber(
              prefixByProjectId.get(hub.projectId) ?? "",
              hub.type,
              hub.partNumber,
            ),
            status: hub.status,
          }
        : null,
    };
  });

  return Response.json({ connectionState: "connected", parts, projects });
});
