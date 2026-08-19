import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeople, displayName } from "@/lib/people";
import { PersonForm } from "@/components/PersonForm";
import { ViewAsButton } from "@/components/ViewAsButton";
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

export default async function AdminPeoplePage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const rows = await listPeople();
  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <div className="sub">Roster, roles, and student IDs · {rows.length} member{rows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/people/duplicates" className="btn btn-secondary">
            Find duplicates
          </Link>
          <Link href="/admin/people/import" className="btn btn-secondary">
            <Icon name="users" /> Import CSV
          </Link>
        </div>
      </div>
      <details className="card">
        <summary className="cursor-pointer text-base font-semibold">Add person</summary>
        <div className="mt-4">
          <PersonForm />
        </div>
      </details>
      {rows.length === 0 ? (
        <p className="card text-[var(--muted)]">No members yet — add your first above.</p>
      ) : (
      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Student ID</th>
                <th>Role</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = displayName(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/people/${r.id}`} className="name-cell hover:no-underline">
                        <span className="avatar" aria-hidden="true">{initials(name)}</span>
                        <span>
                          <div className="nm" style={{ color: "var(--ink)" }}>{name}</div>
                          {r.email && <div className="em">{r.email}</div>}
                        </span>
                      </Link>
                    </td>
                    <td><span className="sid">{r.student_id_number ?? "—"}</span></td>
                    <td><span className={`pill ${r.role === "admin" ? "admin" : "role"}`}>{r.role}</span></td>
                    <td><span className={`pill ${r.is_active ? "on" : "off"}`}>{r.is_active ? "Active" : "Inactive"}</span></td>
                    <td>
                      <div className="rowacts">
                        <Link href={`/admin/people/${r.id}`} className="btn icon" aria-label={`Edit ${name}`}>
                          <Icon name="edit" />
                        </Link>
                        <ViewAsButton personId={r.id} name={name} />
                      </div>
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
