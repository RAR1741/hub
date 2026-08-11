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
    <main>
      <h1>Admin — Periods</h1>
      <h2>Create period</h2>
      <PeriodForm />
      <h2>All periods</h2>
      <table>
        <thead><tr><th>Name</th><th>Starts</th><th>Ends</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.startsOn}</td><td>{p.endsOn}</td>
              <td>{p.isActive ? "active" : ""}</td>
              <td>{p.isActive ? null : <ActivatePeriodButton periodId={p.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
