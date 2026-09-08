import Link from "next/link";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/viewer";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { navDestinations } from "@/lib/nav-destinations";
import { hasRole } from "@/lib/authz";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/ui/Icon";
import { CommandPalette } from "@/components/CommandPalette";

// Desktop top bar: command palette trigger + theme toggle + identity cluster
// (avatar, name·role, sign out), right-aligned. Home to notifications later.
// Hidden on mobile, where the tab bar's More sheet carries theme + sign out
// instead (see globals.css).
export async function SiteTopbar() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  const [viewer, kioskRegistered] = await Promise.all([getViewer(), verifyKioskToken(token)]);
  const person = viewer.person;
  const destinations = navDestinations({ role: viewer.role, kioskRegistered });
  const canSearchPeople = hasRole(viewer.role, "mentor");
  const initials = person
    ? `${person.firstName ?? ""} ${person.lastName ?? ""}`
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  return (
    <header className="topbar">
      <CommandPalette destinations={destinations} canSearchPeople={canSearchPeople} />
      <div className="tb-actions">
        <ThemeToggle />
        {person ? (
          <>
            <Link
              href={`/people/${person.id}`}
              className="who"
              title={`${person.firstName} ${person.lastName} · ${viewer.role}`}
            >
              <span className={`avatar role-${viewer.role}`} aria-hidden="true">
                {initials}
              </span>
              <b>
                {person.firstName} {person.lastName}
              </b>
              <span>· {viewer.role}</span>
            </Link>
            {/* Native POST so sign-out works without client JS; the route clears
                the student-session + sb-* auth cookies server-side. */}
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="signout">
                <Icon name="logout" className="ic" />
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
