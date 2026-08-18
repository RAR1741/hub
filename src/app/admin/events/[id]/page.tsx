import { notFound, redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { getEvent } from "@/lib/events";
import { listEventRoster } from "@/lib/event-signups";
import { listPeople } from "@/lib/people";
import { displayName } from "@/lib/people";
import { listPeriods } from "@/lib/periods";
import { getViewer } from "@/lib/viewer";
import { EventForm } from "@/components/EventForm";
import { EventRosterActions, ManualAddPerson } from "@/components/EventRosterActions";
import { EventUnlinkBanner } from "@/components/EventUnlinkBanner";

export default async function EventRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const { id } = await params;
  const { edit } = await searchParams;
  const event = await getEvent(id);
  if (!event) notFound();

  const [roster, allPeople, periods] = await Promise.all([listEventRoster(id), listPeople(), listPeriods()]);
  const rosterIds = new Set(roster.map((r) => r.personId));
  const addable = allPeople
    .filter((p) => p.is_active && !rosterIds.has(p.id))
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>{event.name}</h1>
          <div className="sub">
            {new Date(event.startsAt).toLocaleString()} – {new Date(event.endsAt).toLocaleString()}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
      </div>

      {event.gcalMissing && <EventUnlinkBanner eventId={id} />}

      <details className="card" open={edit === "1"}>
        <summary className="cursor-pointer font-semibold">Edit event</summary>
        <div className="mt-4">
          <EventForm periods={periods} event={event} />
        </div>
      </details>

      <ManualAddPerson eventId={id} people={addable} />

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Signed up</th><th>Checked in</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.personId}>
                  <td>{r.name}</td>
                  <td className="mono">{r.role}</td>
                  <td>{r.signedUp ? "Yes" : ""}</td>
                  <td>{r.checkedIn ? "Yes" : ""}</td>
                  <td><EventRosterActions eventId={id} entry={r} /></td>
                </tr>
              ))}
              {roster.length === 0 && (
                <tr><td colSpan={5} className="text-sm text-[var(--muted)]">No sign-ups yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
