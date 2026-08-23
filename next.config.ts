import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local dev runs inside the Docker container with the repo bind-mounted from
  // the Windows host. inotify file-change events don't cross that boundary
  // (Docker Desktop / WSL2), so Turbopack's watcher never sees edits and hot
  // reload silently stalls on a stale compile. Poll the filesystem instead —
  // this feeds Turbopack's (and webpack's) watcher a mtime-based fallback.
  // Watching is a dev-only concern: `next build` / `next start` ignore this.
  watchOptions: {
    pollIntervalMs: 500,
  },
  // The /onshape panel routes are meant to be iframed by cad.onshape.com, but
  // a previously-connected user's 90-day panel bearer token lives in
  // localStorage regardless of who's embedding the page — so without this,
  // any site could iframe the panel and clickjack that user into parts CRUD.
  // Scoped to /onshape and /onshape/* only; there's no site-wide frame policy
  // to conflict with.
  async headers() {
    return [
      {
        source: "/onshape",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://*.onshape.com" },
        ],
      },
      {
        source: "/onshape/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://*.onshape.com" },
        ],
      },
    ];
  },
};

export default nextConfig;
