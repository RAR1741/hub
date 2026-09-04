import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listBatteries, listUsage } from "@/lib/batteries";
import { hasRole } from "@/lib/authz";
import type { Battery } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { BatteryForm } from "@/components/BatteryForm";
import { UsageLogForm } from "@/components/UsageLogForm";
import { UsageLogTable } from "@/components/UsageLogTable";

export const metadata: Metadata = { title: "Batteries" };

export default async function BatteriesPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student")) redirect("/login");

  const [batteries, recentUsage] = await Promise.all([listBatteries(), listUsage({ limit: 50 })]);
  const active = batteries.filter((b) => b.status === "active");
  const retired = batteries.filter((b) => b.status === "retired");
  const isMentor = hasRole(viewer.role, "mentor");
  const batteryNumbers = new Map(batteries.map((b) => [b.id, b.number]));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Batteries</h1>
          <div className="sub">Log usage and track the pack inventory.</div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Log usage</h2>
        <div className="mt-4">
          <UsageLogForm batteries={active} />
        </div>
      </div>

      <BatteryTable batteries={active} emptyLabel="No active batteries." />

      {isMentor && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">New battery</summary>
          <div className="mt-4">
            <BatteryForm />
          </div>
        </details>
      )}

      <div>
        <h2 className="font-semibold mb-2">Recent log</h2>
        <UsageLogTable rows={recentUsage} batteryNumbers={batteryNumbers} canDelete={isMentor} />
      </div>

      {retired.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Retired batteries ({retired.length})</summary>
          <div className="mt-4">
            <BatteryTable batteries={retired} emptyLabel="No retired batteries." />
          </div>
        </details>
      )}
    </main>
  );
}

function BatteryTable({
  batteries,
  emptyLabel,
}: {
  batteries: (Battery & { lastUsedAt: string | null })[];
  emptyLabel: string;
}) {
  if (batteries.length === 0) return <p className="card text-sm text-[var(--muted)]">{emptyLabel}</p>;
  return (
    <div className="tablewrap">
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Number</th><th>Model</th><th>Ah</th><th>Last used</th></tr>
          </thead>
          <tbody>
            {batteries.map((b) => (
              <tr key={b.id}>
                <td className="mono"><Link href={`/batteries/${b.id}`}>{b.number}</Link></td>
                <td>{b.model ?? ""}</td>
                <td>{b.ampHourRating ?? ""}</td>
                <td className="mono">{b.lastUsedAt ? new Date(b.lastUsedAt).toLocaleString() : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
