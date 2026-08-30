import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { hasRole } from "@/lib/authz";
import { getEvent } from "@/lib/events";
import { listEventRoster } from "@/lib/event-signups";
import { getViewer } from "@/lib/viewer";
import { PrintButton } from "@/components/PrintButton";

/**
 * Plain print-friendly attendee list for an event: name + role + sign-up/
 * check-in status. Issue #54 — deliberately not GatherPack's grouping/notes/
 * page-break-control roster; add those if mentors ask once this ships.
 */
export const metadata: Metadata = { title: "Event Print" };

export default async function EventRosterPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  const roster = await listEventRoster(id);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head no-print">
        <div>
          <h1>Print roster</h1>
          <div className="sub">{event.name}</div>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/events/${id}`} className="btn btn-secondary">
            Back to event
          </Link>
          <PrintButton />
        </div>
      </div>

      <div className="print-roster">
        <h1>{event.name}</h1>
        <div className="sub">
          {new Date(event.startsAt).toLocaleString()} – {new Date(event.endsAt).toLocaleString()}
          {event.location ? ` · ${event.location}` : ""}
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Signed up</th>
              <th>Checked in</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.personId}>
                <td>{r.name}</td>
                <td className="mono">{r.role}</td>
                <td>{r.signedUp ? "Yes" : ""}</td>
                <td>{r.checkedIn ? "Yes" : ""}</td>
              </tr>
            ))}
            {roster.length === 0 && (
              <tr>
                <td colSpan={4} className="text-sm text-[var(--muted)]">
                  No sign-ups yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
