import { withRole } from "@/lib/api";
import { discardOnshapeToken, getConnection, listElementParts } from "@/lib/onshape";
import { findPartByOnshapeIdentity, listParts, listProjects } from "@/lib/parts";
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

  const rawProjects = await listProjects();
  const prefixByProjectId = new Map(rawProjects.map((p) => [p.id, p.partNumberPrefix]));
  const projects = await Promise.all(
    rawProjects.map(async (p) => {
      const parts = await listParts(p.id);
      const assemblies = parts
        .filter((part) => part.type === "assembly")
        .map((a) => ({
          id: a.id,
          name: a.name,
          fullPartNumber: fullPartNumber(p.partNumberPrefix, a.type, a.partNumber),
        }));
      return { id: p.id, name: p.name, assemblies };
    }),
  );

  const personId = viewer.person!.id;
  const connection = await getConnection(personId);
  if (!connection) {
    return Response.json({ connectionState: "needs_connect", parts: [], projects });
  }

  const result = await listElementParts(personId, {
    documentId,
    wvm: workspaceOrVersion,
    wvmId: workspaceOrVersionId,
    elementId,
    server,
  });
  if ("needsReconnect" in result) {
    return Response.json({ connectionState: "needs_reconnect", parts: [], projects });
  }

  const parts = await Promise.all(
    result.parts.map(async (p) => {
      const hub = await findPartByOnshapeIdentity(documentId, elementId, p.partId);
      const hubPart = hub
        ? {
            id: hub.id,
            fullPartNumber: fullPartNumber(
              prefixByProjectId.get(hub.projectId) ?? "",
              hub.type,
              hub.partNumber,
            ),
            status: hub.status,
          }
        : null;
      return {
        partId: p.partId,
        name: p.name,
        material: p.material,
        onshapePartNumber: p.onshapePartNumber,
        hubPart,
      };
    }),
  );

  return Response.json({ connectionState: "connected", parts, projects });
});
