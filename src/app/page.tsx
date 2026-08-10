import Link from "next/link";
import { getViewer } from "@/lib/viewer";

export default async function HomePage() {
  const viewer = await getViewer();
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
        </>
      ) : (
        <p>
          Browsing as guest. <Link href="/login">Sign in</Link>
        </p>
      )}
    </main>
  );
}
