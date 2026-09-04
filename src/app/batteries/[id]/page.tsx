import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getBattery, listUsage } from "@/lib/batteries";
import { hasRole } from "@/lib/authz";
import { getViewer } from "@/lib/viewer";
import { BatteryForm } from "@/components/BatteryForm";
import { UsageLogTable } from "@/components/UsageLogTable";

export const metadata: Metadata = { title: "Battery" };

export default async function BatteryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student")) redirect("/login");

  const { id } = await params;
  const battery = await getBattery(id);
  if (!battery) notFound();

  const usage = await listUsage({ batteryId: id });
  const isMentor = hasRole(viewer.role, "mentor");

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1 className="mono">{battery.number}</h1>
          <div className="sub">{battery.model ?? ""}</div>
        </div>
      </div>

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <tbody>
              <tr><th>Number</th><td className="mono">{battery.number}</td></tr>
              <tr><th>Status</th><td>{battery.status}</td></tr>
              <tr><th>Model</th><td>{battery.model ?? ""}</td></tr>
              <tr><th>Amp-hour rating</th><td>{battery.ampHourRating ?? ""}</td></tr>
              <tr><th>Year acquired</th><td>{battery.yearAcquired ?? ""}</td></tr>
              <tr><th>Serial/date code</th><td>{battery.serialDateCode ?? ""}</td></tr>
              <tr><th>Manufacturer</th><td>{battery.manufacturer ?? ""}</td></tr>
              <tr><th>Trade name</th><td>{battery.tradeName ?? ""}</td></tr>
              <tr><th>Notes</th><td>{battery.notes ?? ""}</td></tr>
              {battery.status === "retired" && (
                <>
                  <tr><th>Retired at</th><td className="mono">{battery.retiredAt ? new Date(battery.retiredAt).toLocaleDateString() : ""}</td></tr>
                  <tr><th>Retired reason</th><td>{battery.retiredReason ?? ""}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isMentor && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Edit battery</summary>
          <div className="mt-4">
            <BatteryForm initial={battery} />
          </div>
        </details>
      )}

      <div>
        <h2 className="font-semibold mb-2">Usage log</h2>
        <UsageLogTable rows={usage} canDelete={isMentor} />
      </div>
    </main>
  );
}
