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
};

export default nextConfig;
