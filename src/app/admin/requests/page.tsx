import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import {
  listPendingAccountRequests,
  listPendingApplications,
} from "@/lib/requests";
import {
  AccountRequestActions,
  ApplicationActions,
} from "@/components/RequestActions";

export default async function AdminRequestsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [accountRequests, applications] = await Promise.all([
    listPendingAccountRequests(),
    listPendingApplications(),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin — Requests</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Account requests ({accountRequests.length})</h2>
        {accountRequests.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">None pending.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Grad year</th><th>Email</th><th>Requested</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {accountRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.first_name} {r.last_name}</td>
                    <td>{r.grad_year ?? ""}</td>
                    <td>{r.email ?? ""}</td>
                    <td>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td><AccountRequestActions requestId={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Membership applications ({applications.length})</h2>
        {applications.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">None pending.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Person</th><th>Team</th><th>Message</th><th>Applied</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td>{a.personName}</td>
                    <td>{a.teamName}</td>
                    <td>{a.message ?? ""}</td>
                    <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                    <td><ApplicationActions applicationId={a.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
