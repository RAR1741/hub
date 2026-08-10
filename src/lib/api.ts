import { ForbiddenError, requireRole } from "./authz";
import type { Role } from "./types";
import type { Viewer } from "./viewer";

type Handler = (viewer: Viewer, request: Request) => Promise<Response>;

export function withRole(
  required: Role,
  handler: Handler,
  viewerSource?: () => Promise<Viewer>, // injectable for tests
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const getV = viewerSource ?? (await import("./viewer")).getViewer;
    const viewer = await getV();
    try {
      requireRole(viewer.role, required);
    } catch (e) {
      if (e instanceof ForbiddenError) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      throw e;
    }
    return handler(viewer, request);
  };
}
