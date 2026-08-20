import Link from "next/link";
import { listProjects } from "@/lib/parts";

// Public kiosk landing: no auth gate at all (guests + shop-floor TVs).
export default async function ShopIndexPage() {
  const projects = await listProjects();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Shop dashboard</h1>
          <div className="sub">Live manufacturing status, by project.</div>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">No projects yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/shop/${p.id}`} className="card">
              <div className="font-semibold">{p.name}</div>
              <div className="mono text-sm text-[var(--muted)]">{p.partNumberPrefix}</div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
