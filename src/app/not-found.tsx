import Link from "next/link";

/**
 * Branded 404 — both for notFound() calls inside a route and for URLs that match
 * no route at all. Renders inside the root layout, so it keeps the nav, topbar
 * and the app's data-theme choice (Next's stock 404 follows the OS scheme).
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center py-12">
      <div className="card flex max-w-lg flex-col gap-3 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
        <p style={{ color: "var(--muted)" }}>
          That page doesn&apos;t exist, or whatever it pointed at has been removed.
        </p>
        <div className="flex justify-center">
          <Link href="/" className="btn btn-primary">
            Back to the hub
          </Link>
        </div>
      </div>
    </main>
  );
}
