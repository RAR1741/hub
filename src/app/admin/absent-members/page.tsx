import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listAbsentMembers } from "@/lib/sessions";
import { getTeamTimezone } from "@/lib/settings";
import { localDateOf } from "@/lib/attendance";
import { MarkInactiveButton } from "@/components/MarkInactiveButton";

export const metadata: Metadata = { title: "Absent members" };

export default async function AbsentMembersPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");
  const isAdmin = hasRole(viewer.role, "admin");

  const [members, teamTz] = await Promise.all([listAbsentMembers(), getTeamTimezone()]);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Absent members</h1>
          <div className="sub">Active members not currently clocked in, longest absent first.</div>
        </div>
      </div>
      {members.length === 0 ? (
        <p className="card text-[var(--muted)]">Everyone active is clocked in right now.</p>
      ) : (
        <div className="tablewrap">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Last seen</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/people/${m.id}`}>{m.name}</Link>
                    </td>
                    <td className="mono">{m.lastSeen ? localDateOf(m.lastSeen, teamTz) : "Never"}</td>
                    {isAdmin && (
                      <td>
                        <MarkInactiveButton personId={m.id} name={m.name} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
