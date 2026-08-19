import { ForbiddenError, requireRole } from "./authz";
import type { Role } from "./types";
import type { Viewer } from "./viewer";

type Handler<C> = (
  viewer: Viewer,
  request: Request,
  context: C,
) => Promise<Response>;

export function withRole<C = unknown>(
  required: Role,
  handler: Handler<C>,
  viewerSource?: () => Promise<Viewer>, // injectable for tests
): (request: Request, context?: C) => Promise<Response> {
  return async (request: Request, context?: C) => {
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
    // Block mutations while masquerading for safety
    if (
      viewer.masquerade &&
      request.method.toUpperCase() !== "GET" &&
      request.method.toUpperCase() !== "HEAD"
    ) {
      return Response.json(
        { error: "masquerade_read_only" },
        { status: 403 },
      );
    }
    return handler(viewer, request, context as C);
  };
}
