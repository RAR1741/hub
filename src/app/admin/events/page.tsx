import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { listEvents } from "@/lib/events";
import { listPeriods } from "@/lib/periods";
import { getViewer } from "@/lib/viewer";
import { EventForm } from "@/components/EventForm";

export default async function AdminEventsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const [events, periods] = await Promise.all([listEvents(), listPeriods()]);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Events</h1>
          <div className="sub">Outreach, demos, training — sign-up + mentor-run check-in.</div>
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">New event</summary>
        <div className="mt-4">
          <EventForm periods={periods} />
        </div>
      </details>

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Period</th><th>Starts</th><th>Ends</th><th>Location</th><th></th></tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const period = periods.find((p) => p.id === e.periodId);
                return (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td>{period?.name ?? ""}</td>
                    <td className="mono">{new Date(e.startsAt).toLocaleString()}</td>
                    <td className="mono">{new Date(e.endsAt).toLocaleString()}</td>
                    <td>{e.location ?? ""}</td>
                    <td><Link href={`/admin/events/${e.id}`} className="btn btn-secondary px-3 py-1">Roster</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
