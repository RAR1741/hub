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
    <main>
      <h1>People</h1>
      <form method="get">
        <input name="q" defaultValue={q ?? ""} placeholder="Search names" />
        <button type="submit">Search</button>
      </form>
      {view.kind === "names" ? (
        <ul>
          {view.names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Role</th><th>Grad year</th><th>Email</th><th>Active</th>
            </tr>
          </thead>
          <tbody>
            {view.people.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/people/${p.id}`}>
                    {p.displayName ?? `${p.firstName} ${p.lastName}`}
                  </Link>
                </td>
                <td>{p.role}</td>
                <td>{p.gradYear ?? ""}</td>
                <td>{p.email ?? ""}</td>
                <td>{p.isActive ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
