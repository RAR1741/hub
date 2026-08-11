import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { WhosHere } from "@/components/WhosHere";
import { listWhosHere } from "@/lib/sessions";
import { getActivePeriod } from "@/lib/periods";
import { periodLeaderboard } from "@/lib/reports";

export default async function HomePage() {
  const viewer = await getViewer();
  const here = viewer.person ? await listWhosHere() : [];
  const activePeriod = viewer.person ? await getActivePeriod() : null;
  const myHours =
    viewer.person && activePeriod
      ? (await periodLeaderboard(activePeriod.id)).find((e) => e.personId === viewer.person!.id)?.hours ?? 0
      : 0;
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
    </main>
  );
}
