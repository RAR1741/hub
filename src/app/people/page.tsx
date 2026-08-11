import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { listPeople, rosterView } from "@/lib/people";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, viewer] = await Promise.all([searchParams, getViewer()]);
  const view = rosterView(viewer.role, await listPeople(q));

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">People</h1>
      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="label" htmlFor="people-search">
            Search
          </label>
          <input
            id="people-search"
            className="input"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search names"
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>
      {view.kind === "names" ? (
        <ul className="card flex flex-col divide-y divide-[var(--color-border)]">
          {view.names.map((n) => (
            <li key={n} className="py-2 text-sm">
              {n}
            </li>
          ))}
        </ul>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Grad year</th>
                <th>Email</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {view.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link
                      href={`/people/${p.id}`}
                      className="font-medium text-[var(--color-brand)]"
                    >
                      {p.displayName ?? `${p.firstName} ${p.lastName}`}
                    </Link>
                  </td>
                  <td>
                    <span className="badge">{p.role}</span>
                  </td>
                  <td>{p.gradYear ?? ""}</td>
                  <td>{p.email ?? ""}</td>
                  <td>{p.isActive ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
