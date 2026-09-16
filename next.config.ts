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
  async headers() {
    // Baseline security headers applied site-wide. Different header KEYS from the
    // /onshape blocks below, so both sets emit cleanly where they overlap.
    //
    // Deliberately NOT set here: a global Content-Security-Policy. A real CSP for
    // this app needs per-request script nonces and allow-lists for the inline
    // theme script (layout.tsx), the Vercel preview toolbar, Supabase realtime
    // websockets, and Google fonts/OAuth — shipping a blanket policy would break
    // the app. That belongs in its own tested change. Frame protection is covered
    // by X-Frame-Options below (and, for /onshape, the frame-ancestors CSP, which
    // browsers honor over X-Frame-Options).
    const securityHeaders = [
      // Force HTTPS for two years. Ignored by browsers over http (dev/localhost),
      // enforced on Vercel's https deployments.
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      // Stop MIME sniffing (e.g. a text response executed as script).
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Don't leak full URLs (which can carry ids) to third parties.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Anti-clickjacking. Applied to EVERY path, /onshape included (the global
      // rule below matches it too). /onshape stays embeddable by cad.onshape.com
      // because it also sends a frame-ancestors CSP, and per the CSP spec a
      // present frame-ancestors directive supersedes X-Frame-Options — honored by
      // all current browsers (a legacy UA that ignores frame-ancestors would fall
      // back to SAMEORIGIN and simply not embed the panel, which fails safe).
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // The /onshape panel routes are meant to be iframed by cad.onshape.com, but
      // a previously-connected user's 90-day panel bearer token lives in
      // localStorage regardless of who's embedding the page — so without this,
      // any site could iframe the panel and clickjack that user into parts CRUD.
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
