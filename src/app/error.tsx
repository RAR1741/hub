"use client";

import Link from "next/link";

/**
 * Route-level error boundary: catches render-time throws from any page. It does
 * NOT wrap the root layout beside it — chrome failures (SiteNav, SiteTopbar,
 * MasqueradeBanner) are global-error.tsx's job.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center py-12">
      <div className="card flex max-w-lg flex-col gap-3 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p style={{ color: "var(--muted)" }}>
          This page hit an error. Trying again often clears it — if it doesn&apos;t,
          let a mentor know.
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
          <Link href="/" className="btn btn-secondary">
            Back to the hub
          </Link>
        </div>
      </div>
    </main>
  );
}
