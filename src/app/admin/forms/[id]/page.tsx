import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { getFormWithFields } from "@/lib/forms";
import { getViewer } from "@/lib/viewer";
import { FormFieldEditor, FormSettingsForm } from "@/components/FormFieldEditor";

export const metadata: Metadata = { title: "Form" };

export default async function AdminFormEditPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const { id } = await params;
  const data = await getFormWithFields(id);
  if (!data) notFound();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>{data.form.title}</h1>
          <div className="sub">{data.form.status}</div>
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">Edit form</summary>
        <div className="mt-4">
          <FormSettingsForm formId={data.form.id} title={data.form.title} description={data.form.description} status={data.form.status} />
        </div>
      </details>

      <div className="card">
        <h2>Fields</h2>
        <FormFieldEditor formId={data.form.id} fields={data.fields} />
      </div>
    </main>
  );
}
