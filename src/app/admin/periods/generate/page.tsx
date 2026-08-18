import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { GenerateSeasonPeriodsForm } from "@/components/GenerateSeasonPeriodsForm";

export default async function GenerateSeasonPeriodsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Generate season periods</h1>
          <div className="sub">Off Season, Build Season, Competition Season, Outreach, and Training for a year.</div>
        </div>
      </div>
      <div className="card">
        <GenerateSeasonPeriodsForm currentYear={new Date().getFullYear()} />
      </div>
    </main>
  );
}
