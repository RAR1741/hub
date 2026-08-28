import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { displayName } from "@/lib/people";
import { SlackLinkPanel } from "@/components/SlackLinkPanel";

type PersonSlackRow = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  role: "admin" | "mentor" | "student";
  is_active: boolean;
  slack_user_id: string | null;
};

export default async function AdminSlackPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const db = getDb();
  const { data, error } = await db
    .from("person")
    .select("id, first_name, last_name, display_name, role, is_active, slack_user_id")
    .order("last_name");
  if (error) console.error("admin/slack: person select failed:", error.message);
  const people = (data ?? []) as PersonSlackRow[];

  const linked = people.filter((p) => p.slack_user_id);
  const unlinkedStaff = people.filter(
    (p) => p.is_active && !p.slack_user_id && (p.role === "mentor" || p.role === "admin"),
  );

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Slack linking</h1>
          <div className="sub">Match hub people to Slack users by email · {linked.length} linked</div>
        </div>
      </div>

      <section className="card flex flex-col gap-4">
        <SlackLinkPanel />
      </section>

      {error ? (
        <section className="card flex flex-col gap-3">
          <p className="text-sm text-[var(--red)]">Couldn&rsquo;t load the roster — try again.</p>
        </section>
      ) : (
        <>
          <section className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold">Linked people</h2>
            {linked.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No one is linked to Slack yet.</p>
            ) : (
              <div className="tablewrap">
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                        <th>Slack user ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linked.map((p) => (
                        <tr key={p.id}>
                          <td>{displayName(p)}</td>
                          <td>{p.role}</td>
                          <td className="mono">{p.slack_user_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold">Unlinked mentors/admins</h2>
            {unlinkedStaff.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Every active mentor/admin is linked.</p>
            ) : (
              <div className="tablewrap">
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unlinkedStaff.map((p) => (
                        <tr key={p.id}>
                          <td>{displayName(p)}</td>
                          <td>{p.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
