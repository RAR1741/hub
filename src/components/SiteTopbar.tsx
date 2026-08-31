import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/ui/Icon";

// Desktop top bar: theme toggle + identity cluster (avatar, name·role, sign out),
// right-aligned. Home to notifications and search later. Hidden on mobile, where
// the tab bar's More sheet carries theme + sign out instead (see globals.css).
export async function SiteTopbar() {
  const viewer = await getViewer();
  const person = viewer.person;
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
