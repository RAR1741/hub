import { type NextRequest, NextResponse } from "next/server";
import { MASQUERADE_COOKIE } from "./lib/masquerade";

/**
 * Central enforcement: block non-GET/HEAD requests to /api/* when masquerade is active.
 * The masquerade feature is read-only for safety; this proxy prevents mutations
 * on all routes (including those that bypass withRole guards) when masquerading.
 *
 * Exemption: /api/admin/masquerade/exit (allows exiting masquerade session).
 */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Only check API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow GET and HEAD requests always
  if (
    request.method.toUpperCase() === "GET" ||
    request.method.toUpperCase() === "HEAD"
  ) {
    return NextResponse.next();
  }

  // Allow the exit route (needed to clear masquerade)
  if (pathname === "/api/admin/masquerade/exit") {
    return NextResponse.next();
  }

  // Check for active masquerade session
  const masqueradeSessionId = request.cookies.get(MASQUERADE_COOKIE)?.value;
  if (masqueradeSessionId) {
    // Masquerade is active and this is a non-GET mutation on a non-exit route
    return NextResponse.json(
      { error: "masquerade_read_only" },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

// Apply proxy to all /api/* routes
export const config = {
  matcher: ["/api/:path*"],
};
