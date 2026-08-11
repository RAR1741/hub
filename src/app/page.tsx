import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { WhosHere } from "@/components/WhosHere";
import { listWhosHere } from "@/lib/sessions";
import { getActivePeriod } from "@/lib/periods";
import { personPeriodHours } from "@/lib/reports";
import { listUpcomingMeetings } from "@/lib/meetings";

export default async function HomePage() {
  const viewer = await getViewer();
  const here = viewer.person ? await listWhosHere() : [];
  const activePeriod = viewer.person ? await getActivePeriod() : null;
  const myHours =
    viewer.person && activePeriod
      ? await personPeriodHours(viewer.person.id, activePeriod.id)
      : 0;
  const upcoming = await listUpcomingMeetings(new Date().toISOString(), 5);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Team Hub</h1>
      {viewer.person ? (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[var(--color-muted-fg)]">
                Signed in as{" "}
                <span className="font-medium text-[var(--color-fg)]">
                  {viewer.person.displayName ?? viewer.person.firstName}
                </span>{" "}
                ({viewer.role})
              </p>
              <nav aria-label="Quick links" className="mt-3 flex flex-wrap gap-4">
                <Link href="/people" className="text-sm font-medium text-[var(--color-brand)]">
                  People
                </Link>
                <Link href="/teams" className="text-sm font-medium text-[var(--color-brand)]">
                  Teams
                </Link>
              </nav>
            </div>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="btn btn-secondary">
                Sign out
              </button>
            </form>
          </div>

          {activePeriod && (
            <div className="card flex items-baseline gap-3">
              <span className="text-sm text-[var(--color-muted-fg)]">
                {activePeriod.name}
              </span>
              <span className="text-3xl font-bold text-[var(--color-brand)]">
                {myHours}
              </span>
              <span className="text-sm text-[var(--color-muted-fg)]">hours</span>
            </div>
          )}

          <WhosHere initial={here.map((h) => ({ name: h.name, since: h.since }))} />
        </>
      ) : (
        <p className="card text-[var(--color-muted-fg)]">
          Browsing as guest.{" "}
          <Link href="/login" className="font-medium text-[var(--color-brand)]">
            Sign in
          </Link>
        </p>
      )}
      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Upcoming meetings</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            No upcoming meetings scheduled.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {upcoming.map((m) => (
              <li key={m.id} className="py-2 text-sm">
                <span className="text-[var(--color-muted-fg)]">
                  {new Date(m.startsAt).toLocaleString()}
                </span>{" "}
                — {m.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
