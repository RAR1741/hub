import { ForbiddenError, requireRole } from "./authz";
import type { Role } from "./types";
import type { Viewer } from "./viewer";

type Handler<C> = (
  viewer: Viewer,
  request: Request,
  context: C,
) => Promise<Response>;

/**
 * Masquerade is read-only: an admin viewing the app as someone else must not
 * mutate as that person. Returns a 403 Response when the viewer is
 * masquerading, else null.
 *
 * The proxy middleware (src/proxy.ts) already blocks non-GET /api/* requests
 * while masquerading, and withRole enforces it too. Call this at the top of any
 * MUTATING handler that resolves the viewer via getViewer() directly (rather
 * than withRole), so the guarantee never rests on the middleware alone.
 * The masquerade-exit route must NOT call this — exiting is how you stop.
 */
export function masqueradeReadOnly(viewer: Viewer): Response | null {
  return viewer.masquerade
    ? Response.json({ error: "masquerade_read_only" }, { status: 403 })
    : null;
}

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
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const blocked = masqueradeReadOnly(viewer);
      if (blocked) return blocked;
    }
    return handler(viewer, request, context as C);
  };
}
