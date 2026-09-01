import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { getEvent } from "@/lib/events";
import { signedUpEventIds } from "@/lib/event-signups";
import { getFormWithFields } from "@/lib/forms";
import { getTeamTimezone } from "@/lib/settings";
import { getViewer } from "@/lib/viewer";
import { EventSignupButton } from "@/components/EventSignupButton";
import { EventSignupForm } from "@/components/EventSignupForm";

export const metadata: Metadata = { title: "Event" };

function hasEventEnded(endsAt: string): boolean {
  return Date.parse(endsAt) <= Date.now();
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer.person) redirect("/login");

  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  const teamTz = await getTeamTimezone();
  const signedUp = await signedUpEventIds(viewer.person.id, [event.id]);
  const isSignedUp = signedUp.has(event.id);
  const form = event.formId ? await getFormWithFields(event.formId) : null;
  const showForm = !isSignedUp && form !== null;
  const hasEnded = hasEventEnded(event.endsAt);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>{event.name}</h1>
          <div className="sub mono">
            {new Date(event.startsAt).toLocaleString(undefined, { timeZone: teamTz })} –{" "}
            {new Date(event.endsAt).toLocaleString(undefined, { timeZone: teamTz })}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
        {hasRole(viewer.role, "mentor") && (
          <Link href={`/admin/events/${event.id}?edit=1`} className="btn btn-secondary px-3 py-1">Edit</Link>
        )}
      </div>

      {event.description && <div className="card text-sm text-[var(--muted)]">{event.description}</div>}

      {hasEnded ? (
        <p className="pill">This event has ended.</p>
      ) : showForm ? (
        <EventSignupForm eventId={event.id} eventName={event.name} fields={form.fields} />
      ) : (
        <EventSignupButton eventId={event.id} initiallySignedUp={isSignedUp} />
      )}
    </main>
  );
}
