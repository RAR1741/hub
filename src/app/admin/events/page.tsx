import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { listEvents } from "@/lib/events";
import { listPeriods } from "@/lib/periods";
import type { Event, Period } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { EventForm } from "@/components/EventForm";

export default async function AdminEventsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const [events, periods] = await Promise.all([listEvents(), listPeriods()]);
  const now = new Date().toISOString();
  const upcoming = events.filter((e) => e.endsAt >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = events.filter((e) => e.endsAt < now);

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

      <EventTable events={upcoming} periods={periods} emptyLabel="No upcoming events." />

      {past.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Previous events ({past.length})</summary>
          <div className="mt-4">
            <EventTable events={past} periods={periods} emptyLabel="No previous events." />
          </div>
        </details>
      )}
    </main>
  );
}

function EventTable({ events, periods, emptyLabel }: { events: Event[]; periods: Period[]; emptyLabel: string }) {
  if (events.length === 0) return <p className="card text-sm text-[var(--muted)]">{emptyLabel}</p>;
  return (
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
                  <td className="flex gap-2">
                    <Link href={`/admin/events/${e.id}`} className="btn btn-secondary px-3 py-1">Roster</Link>
                    <Link href={`/admin/events/${e.id}?edit=1`} className="btn btn-secondary px-3 py-1">Edit</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
