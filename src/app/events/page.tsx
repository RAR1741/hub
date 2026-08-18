import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { listUpcomingEvents } from "@/lib/events";
import { signedUpEventIds } from "@/lib/event-signups";
import { getViewer } from "@/lib/viewer";
import { EventSignupButton } from "@/components/EventSignupButton";

export default async function EventsPage() {
  const viewer = await getViewer();
  if (!viewer.person) redirect("/login");
  const canEdit = hasRole(viewer.role, "mentor");

  const events = await listUpcomingEvents();
  const signedUp = await signedUpEventIds(viewer.person.id, events.map((e) => e.id));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Events</h1>
          <div className="sub">Sign up for upcoming outreach, demos, and training.</div>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">No upcoming events.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((e) => (
            <div key={e.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{e.name}</div>
                <div className="sub mono">
                  {new Date(e.startsAt).toLocaleString()} – {new Date(e.endsAt).toLocaleString()}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
                {e.description && <div className="text-sm text-[var(--muted)]">{e.description}</div>}
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <Link href={`/admin/events/${e.id}?edit=1`} className="btn btn-secondary px-3 py-1">Edit</Link>
                )}
                <EventSignupButton eventId={e.id} initiallySignedUp={signedUp.has(e.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
