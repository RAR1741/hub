import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeriods } from "@/lib/periods";
import { PeriodForm } from "@/components/PeriodForm";
import { ActivatePeriodButton } from "@/components/ActivatePeriodButton";

export default async function AdminPeriodsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const periods = await listPeriods();
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin — Periods</h1>
      <section className="card flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Create period</h2>
        <PeriodForm />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">All periods</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>Starts</th><th>Ends</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td>{p.startsOn}</td><td>{p.endsOn}</td>
                  <td>{p.isActive ? <span className="badge badge-present">active</span> : ""}</td>
                  <td>{p.isActive ? null : <ActivatePeriodButton periodId={p.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
