import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { listBuildDays } from "@/lib/build-days";
import { BuildDayForm } from "@/components/BuildDayForm";
import { BuildDayRow } from "@/components/BuildDayRow";

export default async function AdminBuildDaysPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const period = await getActivePeriod();
  const buildDays = period
    ? await listBuildDays({ from: period.startsOn, to: period.endsOn })
    : [];

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Build days</h1>
          <div className="sub">
            {period ? `${period.name} · ${buildDays.length} day${buildDays.length === 1 ? "" : "s"}` : "No active period"}
          </div>
        </div>
      </div>
      {!period ? (
        <p className="card text-[var(--muted)]">No active period. Create one in Admin → Periods.</p>
      ) : (
        <>
          <div className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold">Add build day</h2>
            <BuildDayForm />
          </div>
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Kind</th>
                    <th>Source</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {buildDays.map((b) => (
                    <BuildDayRow key={b.date} date={b.date} kind={b.kind} source={b.source} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
