import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";

export async function SiteNav() {
  const viewer = await getViewer();
  return (
    <nav>
      <Link href="/">Home</Link> <Link href="/people">People</Link>{" "}
      <Link href="/teams">Teams</Link>{" "}
      <Link href="/kiosk">Kiosk</Link> <Link href="/leaderboard">Leaderboard</Link>{" "}
      {hasRole(viewer.role, "mentor") && (
        <Link href="/admin/sessions/flagged">Flagged sessions</Link>
      )}{" "}
      {hasRole(viewer.role, "admin") && (
        <>
          <Link href="/admin/people">Admin: People</Link>{" "}
          <Link href="/admin/teams">Admin: Teams</Link>{" "}
          <Link href="/admin/requests">Admin: Requests</Link>{" "}
          <Link href="/admin/periods">Admin: Periods</Link>{" "}
          <Link href="/admin/kiosk-devices">Admin: Kiosk</Link>{" "}
          <Link href="/admin/settings">Admin: Settings</Link>{" "}
        </>
      )}
      {viewer.person ? (
        <span>
          {viewer.person.displayName ?? viewer.person.firstName} ({viewer.role})
        </span>
      ) : (
        <Link href="/login">Sign in</Link>
      )}
    </nav>
  );
}
