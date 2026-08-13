import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import {
  listPendingAccountRequests,
  listPendingApplications,
} from "@/lib/requests";
import { listPendingExcusalRequests } from "@/lib/excusal-requests";
import {
  AccountRequestActions,
  ApplicationActions,
  ExcusalRequestActions,
} from "@/components/RequestActions";

export default async function AdminRequestsPage() {
  const viewer = await getViewer();
  // Mentors+ can review requests (matches the review routes' withRole("mentor") gates).
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const [accountRequests, applications, excusalRequests] = await Promise.all([
    listPendingAccountRequests(),
    listPendingApplications(),
    listPendingExcusalRequests(),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Requests</h1>
          <div className="sub">Pending account + team-join approvals</div>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Account requests ({accountRequests.length})</h2>
        {accountRequests.length === 0 ? (
          <p className="card text-sm text-[var(--muted)]">None pending.</p>
        ) : (
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Grad year</th><th>Email</th><th>Requested</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {accountRequests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.first_name} {r.last_name}</td>
                      <td className="mono">{r.grad_year ?? ""}</td>
                      <td>{r.email ?? ""}</td>
                      <td className="mono">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td><AccountRequestActions requestId={r.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Membership applications ({applications.length})</h2>
        {applications.length === 0 ? (
          <p className="card text-sm text-[var(--muted)]">None pending.</p>
        ) : (
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
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
                      <td className="mono">{new Date(a.createdAt).toLocaleDateString()}</td>
                      <td><ApplicationActions applicationId={a.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Excusal requests ({excusalRequests.length})</h2>
        {excusalRequests.length === 0 ? (
          <p className="card text-sm text-[var(--muted)]">No pending excusal requests.</p>
        ) : (
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Date</th><th>Reason</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {excusalRequests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="mono">{r.date}</td>
                      <td>{r.reason ?? ""}</td>
                      <td><ExcusalRequestActions requestId={r.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
