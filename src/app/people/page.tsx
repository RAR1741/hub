import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeople, rosterView } from "@/lib/people";
import { Icon } from "@/components/Icon";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, viewer] = await Promise.all([searchParams, getViewer()]);
  // People is mentor+ only — students and guests are redirected to login.
  if (!hasRole(viewer.role, "mentor")) redirect("/login");
  const view = rosterView(viewer.role, await listPeople(q));
  const count = view.kind === "names" ? view.names.length : view.people.length;
  // People are edited from /admin/people, which is admin-gated.
  const canEdit = hasRole(viewer.role, "admin");

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <div className="sub">Roster · {count} member{count === 1 ? "" : "s"}</div>
        </div>
      </div>
      {view.kind === "names" ? (
        <div className="tablewrap">
          <form method="get" className="toolbar">
            <label className="search">
              <Icon name="search" />
              <input
                aria-label="Search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search names"
              />
            </label>
            <button type="submit" className="btn btn-primary">
              Search
            </button>
          </form>
          {view.names.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted)]">
              {q ? "No members match that search — try a different name." : "No members yet."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--hair)]">
              {view.names.map((n) => (
                <li key={n} className="px-4 py-3 text-sm">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="tablewrap">
          <form method="get" className="toolbar">
            <label className="search">
              <Icon name="search" />
              <input
                aria-label="Search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search name, email, or ID…"
              />
            </label>
            <button type="submit" className="btn btn-primary">
              Search
            </button>
          </form>
          {view.people.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted)]">
              {q ? "No members match that search — try a different name, email, or ID." : "No members yet — add your first from Admin → People."}
            </p>
          ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Student ID</th>
                  <th>Role</th>
                  <th>Status</th>
                  {canEdit && <th aria-label="Edit" />}
                </tr>
              </thead>
              <tbody>
                {view.people.map((p) => {
                  const name = `${p.firstName} ${p.lastName}`;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/people/${p.id}`} className="name-cell hover:no-underline">
                          <span className="avatar" aria-hidden="true">
                            {initials(name)}
                          </span>
                          <span>
                            <div className="nm" style={{ color: "var(--ink)" }}>
                              {name}
                            </div>
                            {p.email && <div className="em">{p.email}</div>}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="sid">{p.studentIdNumber ?? "—"}</span>
                      </td>
                      <td>
                        <span className={`pill ${p.role === "admin" ? "admin" : "role"}`}>
                          {p.role}
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${p.isActive ? "on" : "off"}`}>
                          {p.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      {canEdit && (
                        <td>
                          <Link
                            href={`/admin/people/${p.id}`}
                            className="btn icon"
                            aria-label={`Edit ${name}`}
                          >
                            <Icon name="edit" />
                          </Link>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </main>
  );
}
