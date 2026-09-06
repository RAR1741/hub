import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTool, listChecks, nextDueAt } from "@/lib/tools";
import { hasPendingDeleteRequest } from "@/lib/tool-delete-requests";
import { hasRole } from "@/lib/authz";
import { getViewer } from "@/lib/viewer";
import { ToolForm } from "@/components/ToolForm";
import { ToolCheckTable } from "@/components/ToolCheckTable";
import { DeleteToolButton } from "@/components/DeleteToolButton";
import { ToolDeleteRequestForm } from "@/components/ToolDeleteRequestForm";

export const metadata: Metadata = { title: "Tool" };

export default async function ToolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student")) redirect("/login");

  const { id } = await params;
  const tool = await getTool(id);
  if (!tool) notFound();

  const [checks, pendingDelete] = await Promise.all([
    listChecks({ toolId: id }),
    hasPendingDeleteRequest(id),
  ]);
  const isMentor = hasRole(viewer.role, "mentor");
  const lastCheckedAt = checks[0]?.checkedAt ?? null;
  const due = nextDueAt(tool, lastCheckedAt);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>{tool.name}</h1>
          <div className="sub">{tool.category ?? ""}</div>
        </div>
      </div>

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <tbody>
              <tr><th>Name</th><td>{tool.name}</td></tr>
              <tr><th>Status</th><td><span className="pill">{tool.status.replace(/_/g, " ")}</span></td></tr>
              <tr><th>Category</th><td>{tool.category ?? ""}</td></tr>
              <tr><th>Location</th><td>{tool.location ?? ""}</td></tr>
              <tr><th>Asset tag</th><td className="mono">{tool.assetTag ?? ""}</td></tr>
              <tr><th>Maintenance interval</th><td>{tool.maintenanceIntervalDays ? `${tool.maintenanceIntervalDays} days` : ""}</td></tr>
              <tr><th>Last checked</th><td className="mono">{lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : "Never"}</td></tr>
              <tr><th>Next due</th><td className="mono">{due ? new Date(due).toLocaleDateString() : ""}</td></tr>
              <tr><th>Notes</th><td>{tool.notes ?? ""}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">Edit tool</summary>
        <div className="mt-4">
          <ToolForm initial={tool} />
        </div>
      </details>

      <div>
        <h2 className="font-semibold mb-2">Check history</h2>
        <ToolCheckTable rows={checks} canDelete={isMentor} />
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="font-semibold">Danger zone</h2>
        {pendingDelete && <span className="pill">Deletion requested</span>}
        {isMentor ? (
          <DeleteToolButton toolId={tool.id} />
        ) : (
          !pendingDelete && <ToolDeleteRequestForm toolId={tool.id} />
        )}
      </div>
    </main>
  );
}
