import Link from "next/link";
import { getViewer } from "@/lib/viewer";
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
  const view = rosterView(viewer.role, await listPeople(q));
  const count = view.kind === "names" ? view.names.length : view.people.length;

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
          <ul className="flex flex-col divide-y divide-[var(--hair)]">
            {view.names.map((n) => (
              <li key={n} className="px-4 py-3 text-sm">
                {n}
              </li>
            ))}
          </ul>
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
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Student ID</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {view.people.map((p) => {
                  const name = p.displayName ?? `${p.firstName} ${p.lastName}`;
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
