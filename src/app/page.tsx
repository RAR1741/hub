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
    <main>
      <h1>Team Hub</h1>
      {viewer.person ? (
        <>
          <p>
            Signed in as {viewer.person.displayName ?? viewer.person.firstName}{" "}
            ({viewer.role})
          </p>
          <form action="/api/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
          <ul>
            <li>
              <Link href="/people">People</Link>
            </li>
            <li>
              <Link href="/teams">Teams</Link>
            </li>
          </ul>
          {activePeriod && (
            <p>
              {activePeriod.name}: you have <strong>{myHours}</strong> h.
            </p>
          )}
          <WhosHere initial={here.map((h) => ({ name: h.name, since: h.since }))} />
        </>
      ) : (
        <p>
          Browsing as guest. <Link href="/login">Sign in</Link>
        </p>
      )}
      <section>
        <h2>Upcoming meetings</h2>
        {upcoming.length === 0 ? (
          <p>No upcoming meetings scheduled.</p>
        ) : (
          <ul>
            {upcoming.map((m) => (
              <li key={m.id}>
                {new Date(m.startsAt).toLocaleString()} — {m.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
