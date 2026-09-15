"use client";

import { fontVariables, noFlashThemeScript } from "./root-document";
import "./globals.css";

/**
 * Last-resort boundary: replaces the root layout when the chrome itself throws
 * (SiteNav / SiteTopbar / MasqueradeBanner all do auth + DB work in server
 * components, and error.tsx can't catch those). Because it stands in for the
 * layout it has to ship its own html/body, fonts and theme script.
 *
 * Client components can't export metadata, hence the <title> element. The theme
 * here is localStorage-only — the layout's server-side cookie read isn't
 * available, which is acceptable degradation on a total-failure screen.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <title>Something went wrong - 1741 Hub</title>
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
      </head>
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-12">
          <div className="card flex w-full flex-col gap-3 text-center">
            <h1 className="text-2xl font-bold tracking-tight">The hub hit an error</h1>
            <p style={{ color: "var(--muted)" }}>
              Something broke outside the page itself. Try again, or reload the hub
              — if it keeps happening, let a mentor know.
            </p>
            {error.digest && (
              <p className="mono text-xs" style={{ color: "var(--muted)" }}>
                Error ID: {error.digest}
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => retry()}>
                Try again
              </button>
              {/* Plain anchor, not next/link: the router tree is the thing that
                  failed, so a full document load is the reliable way back. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="btn btn-secondary">
                Reload the hub
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
