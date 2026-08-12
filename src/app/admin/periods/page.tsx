import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeriods } from "@/lib/periods";
import { PeriodForm } from "@/components/PeriodForm";
import { ActivatePeriodButton } from "@/components/ActivatePeriodButton";
import { DeletePeriodButton } from "@/components/DeletePeriodButton";

export default async function AdminPeriodsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const periods = await listPeriods();
  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Periods</h1>
          <div className="sub">Seasons and the active period · {periods.length} total</div>
        </div>
      </div>
      <details className="card">
        <summary className="cursor-pointer text-base font-semibold">Create period</summary>
        <div className="mt-4">
          <PeriodForm />
        </div>
      </details>
      {periods.length === 0 ? (
        <p className="card text-[var(--muted)]">No periods yet — create the first season above.</p>
      ) : (
      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono">{p.startsOn}</td>
                  <td className="mono">{p.endsOn}</td>
                  <td>{p.isActive ? <span className="pill on">Active</span> : <span className="pill off">Inactive</span>}</td>
                  <td>
                    <div className="rowacts">
                      {!p.isActive && <ActivatePeriodButton periodId={p.id} />}
                      <DeletePeriodButton periodId={p.id} name={p.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </main>
  );
}
