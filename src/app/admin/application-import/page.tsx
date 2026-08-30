import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { ApplicationImportForm } from "@/components/ApplicationImportForm";

export const metadata: Metadata = { title: "Application Import" };

export default async function AdminApplicationImportPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Import applications</h1>
          <div className="sub">Bulk-import a season&apos;s student applications from a Google-Forms CSV export</div>
        </div>
      </div>
      <ApplicationImportForm />
    </main>
  );
}
