import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listChecks, listTools, nextDueAt } from "@/lib/tools";
import { hasRole } from "@/lib/authz";
import type { Tool } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { ToolForm } from "@/components/ToolForm";
import { ToolCheckForm } from "@/components/ToolCheckForm";
import { ToolCheckTable } from "@/components/ToolCheckTable";

export const metadata: Metadata = { title: "Tools" };

export default async function ToolsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student")) redirect("/login");

  const [tools, recentChecks] = await Promise.all([listTools(), listChecks({ limit: 50 })]);
  const notRetired = tools.filter((t) => t.status !== "retired");
  const retired = tools.filter((t) => t.status === "retired");
  const toolNames = new Map(tools.map((t) => [t.id, t.name]));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Tools</h1>
          <div className="sub">Log checks and track the tool inventory.</div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Log a check</h2>
        <div className="mt-4">
          <ToolCheckForm tools={notRetired} />
        </div>
      </div>

      <ToolTable tools={notRetired} emptyLabel="No tools yet." />

      <details className="card">
        <summary className="cursor-pointer font-semibold">New tool</summary>
        <div className="mt-4">
          <ToolForm />
        </div>
      </details>

      <div>
        <h2 className="font-semibold mb-2">Recent checks</h2>
        <ToolCheckTable rows={recentChecks} toolNames={toolNames} canDelete={hasRole(viewer.role, "mentor")} />
      </div>

      {retired.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Retired tools ({retired.length})</summary>
          <div className="mt-4">
            <ToolTable tools={retired} emptyLabel="No retired tools." />
          </div>
        </details>
      )}
    </main>
  );
}

function ToolTable({
  tools,
  emptyLabel,
}: {
  tools: (Tool & { lastCheckedAt: string | null })[];
  emptyLabel: string;
}) {
  if (tools.length === 0) return <p className="card text-sm text-[var(--muted)]">{emptyLabel}</p>;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  return (
    <div className="tablewrap">
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Category</th><th>Location</th><th>Status</th><th>Last checked</th><th>Due</th></tr>
          </thead>
          <tbody>
            {tools.map((t) => {
              const due = nextDueAt(t, t.lastCheckedAt);
              const isDue = due !== null && due <= now.toISOString();
              const isPastDue = isDue && due!.slice(0, 10) < today;
              return (
                <tr key={t.id}>
                  <td><Link href={`/tools/${t.id}`}>{t.name}</Link></td>
                  <td>{t.category ?? ""}</td>
                  <td>{t.location ?? ""}</td>
                  <td><span className="pill">{t.status.replace(/_/g, " ")}</span></td>
                  <td className="mono">{t.lastCheckedAt ? new Date(t.lastCheckedAt).toLocaleString() : "Never"}</td>
                  <td className="mono">{isDue ? (isPastDue ? `Overdue since ${new Date(due!).toLocaleDateString()}` : "Due") : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
