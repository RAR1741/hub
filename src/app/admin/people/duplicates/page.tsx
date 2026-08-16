import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listDuplicateCandidates } from "@/lib/merge-people";
import { DuplicatePeople } from "@/components/DuplicatePeople";

export default async function AdminDuplicatePeoplePage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const pairs = await listDuplicateCandidates();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Find duplicates</h1>
          <div className="sub">
            Possible duplicate people, ranked by match confidence · {pairs.length} pair{pairs.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <section className="card flex flex-col gap-4">
        <p className="text-sm text-[var(--muted)]">
          Review each pair below. Pick which record to keep, then merge — the other
          record&rsquo;s sessions, teams, emails, and history move to the one you keep,
          and it is deleted. This can&rsquo;t be undone.
        </p>
        <DuplicatePeople pairs={pairs} />
      </section>
    </main>
  );
}
