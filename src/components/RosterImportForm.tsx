"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseRosterCsv, type ParsedRosterRow } from "@/lib/roster-import";

/** Minimal identity of an existing person, used only for the client-side
 * New-vs-Update preview hint (the server re-matches independently and is the
 * source of truth for what actually happens on Import). */
export type ExistingPersonKey = {
  email: string | null;
  studentIdNumber: string | null;
};

type PreviewRow =
  | { line: number; kind: "error"; message: string }
  | { line: number; kind: "new" | "update"; row: ParsedRosterRow };

type PreviewResult = {
  rows: PreviewRow[];
  counts: { new: number; update: number; error: number };
};

type RowResult = { line: number; status: "created" | "updated" | "error"; message?: string };

type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
  results: RowResult[];
};

function buildPreview(text: string, existing: ExistingPersonKey[]): PreviewResult {
  const { rows, errors } = parseRosterCsv(text);
  const existingEmails = new Set(existing.map((e) => e.email).filter((v): v is string => !!v));
  const existingStudentIds = new Set(
    existing.map((e) => e.studentIdNumber).filter((v): v is string => !!v),
  );

  const preview: PreviewRow[] = [];
  for (const e of errors) preview.push({ line: e.line, kind: "error", message: e.message });
  for (const row of rows) {
    const matches =
      (row.email !== null && existingEmails.has(row.email)) ||
      (row.studentIdNumber !== null && existingStudentIds.has(row.studentIdNumber));
    preview.push({ line: row.line, kind: matches ? "update" : "new", row });
  }
  preview.sort((a, b) => a.line - b.line);

  return {
    rows: preview,
    counts: {
      new: preview.filter((p) => p.kind === "new").length,
      update: preview.filter((p) => p.kind === "update").length,
      error: preview.filter((p) => p.kind === "error").length,
    },
  };
}

export function RosterImportForm({ existing }: { existing: ExistingPersonKey[] }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setPreview(null);
      setSummary(null);
      setStatus(null);
    };
    reader.readAsText(file);
  }

  function runPreview() {
    setPreview(buildPreview(text, existing));
    setSummary(null);
    setStatus(null);
  }

  async function runImport() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/people/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      if (res.ok) {
        const data = (await res.json()) as ImportSummary;
        setSummary(data);
        setStatus(
          `Imported: ${data.created} created, ${data.updated} updated, ${data.skipped} skipped, ${data.errors.length} error(s).`,
        );
        // Re-run the preview against the (now stale, but good-enough) local
        // "existing" snapshot is pointless — refresh the page data instead so
        // a second Preview reflects what's really in the DB.
        router.refresh();
      } else if (res.status === 403) {
        setStatus("Forbidden — admin role required.");
      } else {
        setStatus("Import failed — check the CSV and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">1. Provide a CSV</h2>
          <a href="/api/admin/people/import" className="btn btn-secondary" download="roster-template.csv">
            Download template
          </a>
        </div>
        <label className="label">
          Upload a file
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="input"
            onChange={onFileChange}
          />
        </label>
        <label className="label">
          …or paste CSV text
          <textarea
            className="input"
            rows={10}
            spellCheck={false}
            placeholder="first_name,last_name,email,role,grad_year,student_id_number"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
              setSummary(null);
              setStatus(null);
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={runPreview} disabled={!text.trim()}>
            Preview
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={runImport}
            disabled={busy || !text.trim()}
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
        {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
      </section>

      {preview && (
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">2. Preview</h2>
            <div className="flex gap-2">
              <span className="pill new">{preview.counts.new} new</span>
              <span className="pill update">{preview.counts.update} update</span>
              <span className="pill error">{preview.counts.error} error</span>
            </div>
          </div>
          {preview.rows.length === 0 ? (
            <p className="text-[var(--muted)]">No data rows found.</p>
          ) : (
            <div className="tablewrap">
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Status</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Grad year</th>
                      <th>Student ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((p, i) => (
                      <tr key={`${p.line}-${i}`}>
                        <td className="mono">{p.line}</td>
                        {p.kind === "error" ? (
                          <>
                            <td><span className="pill error">Error</span></td>
                            <td colSpan={5} className="text-[var(--absent)]">{p.message}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              <span className={`pill ${p.kind}`}>{p.kind === "new" ? "New" : "Update"}</span>
                            </td>
                            <td>{p.row.firstName} {p.row.lastName}</td>
                            <td>{p.row.email ?? "—"}</td>
                            <td>{p.row.role}</td>
                            <td className="mono">{p.row.gradYear ?? "—"}</td>
                            <td className="sid">{p.row.studentIdNumber ?? "—"}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {summary && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold">3. Result</h2>
          <div className="flex gap-2 flex-wrap">
            <span className="pill new">{summary.created} created</span>
            <span className="pill update">{summary.updated} updated</span>
            <span className="pill error">{summary.skipped} skipped</span>
          </div>
          {summary.errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {summary.errors.map((e, i) => (
                <li key={`${e.line}-${i}`} className="text-[var(--absent)]">
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
