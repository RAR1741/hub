import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeriods } from "@/lib/periods";
import { TimeImportForm } from "@/components/TimeImportForm";

export default async function AdminTimeImportPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");
  const periods = await listPeriods();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Import time sheet</h1>
          <div className="sub">Bulk-import a season&apos;s attendance from a Google-Sheets CSV export</div>
        </div>
      </div>
      <TimeImportForm periods={periods.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))} />
    </main>
  );
}
