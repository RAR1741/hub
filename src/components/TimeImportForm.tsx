"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseTimeSheet } from "@/lib/time-import";
import type { TimeImportSummary } from "@/lib/time-import-run";

type PeriodOpt = { id: string; name: string; isActive: boolean; startsOn: string; endsOn: string };

export function TimeImportForm({ periods }: { periods: PeriodOpt[] }) {
  const [text, setText] = useState("");
  const [periodId, setPeriodId] = useState(periods.find((p) => p.isActive)?.id ?? periods[0]?.id ?? "");
  const [preview, setPreview] = useState<ReturnType<typeof parseTimeSheet> | null>(null);
  const [dry, setDry] = useState<TimeImportSummary | null>(null);
  // The exact (text, period) a successful preview was run for — Import is gated on this matching.
  const [previewedFor, setPreviewedFor] = useState<{ text: string; periodId: string } | null>(null);
  const [summary, setSummary] = useState<TimeImportSummary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Any change to the file or period invalidates a prior preview — you must re-glance before importing.
  function resetPreview() {
    setPreview(null); setDry(null); setPreviewedFor(null); setSummary(null); setStatus(null);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result ?? "")); resetPreview(); };
    reader.readAsText(file);
  }

  const counts = preview && {
    people: preview.people.length,
    students: preview.people.filter((p) => p.roleHint === "student").length,
    mentors: preview.people.filter((p) => p.roleHint === "mentor").length,
    sessions: preview.people.reduce((n, p) => n + p.sessions.length, 0),
    excusals: preview.people.reduce((n, p) => n + p.excusals.length, 0),
    skipped: preview.people.reduce((n, p) => n + p.skipped.length, 0),
    anomalies: preview.people.reduce((n, p) => n + p.anomalies.length, 0),
  };

  const selectedPeriod = periods.find((p) => p.id === periodId);
  const outOfRange = preview && selectedPeriod ? preview.dates.filter((d) => d < selectedPeriod.startsOn || d > selectedPeriod.endsOn) : [];
  const importReady = !!previewedFor && previewedFor.text === text && previewedFor.periodId === periodId;

  async function doPreview() {
    setBusy(true); setStatus(null); setSummary(null);
    setPreview(parseTimeSheet(text));
    try {
      // Dry-run (no confirm) — the server matches against the roster and reports role changes without writing.
      const res = await fetch("/api/admin/time-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, periodId }),
      });
      if (res.ok) {
        setDry((await res.json()) as TimeImportSummary);
        setPreviewedFor({ text, periodId });
      } else {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus(`Preview failed${err?.error ? ` — ${err.error}` : ""}.`);
        setDry(null); setPreviewedFor(null);
      }
    } finally { setBusy(false); }
  }

  async function runImport() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch("/api/admin/time-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, periodId, confirm: true, applyRoleChanges: true }),
      });
      if (res.ok) {
        const data = (await res.json()) as TimeImportSummary;
        setSummary(data);
        setStatus(`Imported ${data.sessions} sessions, ${data.excusals} excusals · ${data.createdPeople} people created, ${data.matchedPeople} matched · ${data.roleChanges.length} roles changed · ${data.skipped.length} skipped, ${data.anomalies.length} anomalies, ${data.errors.length} errors.`);
        router.refresh();
      } else if (res.status === 403) {
        setStatus("Forbidden — admin role required.");
      } else {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus(`Import failed${err?.error ? ` — ${err.error}` : ""}.`);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">1. Choose a season and file</h2>
        <label className="label">
          Target period
          <select className="input" value={periodId} onChange={(e) => { setPeriodId(e.target.value); resetPreview(); }}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isActive ? " (active)" : ""}</option>)}
          </select>
        </label>
        <label className="label">
          Upload CSV
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary" onClick={doPreview} disabled={busy || !text.trim() || !periodId}>
            {busy && !summary ? "Previewing…" : "Preview"}
          </button>
          <button type="button" className="btn btn-primary" onClick={runImport} disabled={busy || !importReady} title={importReady ? undefined : "Preview first"}>
            {busy && summary === null && importReady ? "Importing…" : "Import"}
          </button>
          {!importReady && <span className="text-sm text-[var(--muted)]">Preview first — review the summary below before importing.</span>}
        </div>
        {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
      </section>

      {preview && counts && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold">2. Preview</h2>
          <div className="flex flex-wrap gap-2">
            <span className="pill new">{counts.people} people</span>
            <span className="pill">{counts.students} students · {counts.mentors} mentors</span>
            <span className="pill">{counts.sessions} sessions</span>
            <span className="pill">{counts.excusals} excusals</span>
            <span className="pill update">{counts.skipped} skipped</span>
            <span className="pill error">{counts.anomalies} anomalies</span>
          </div>
          {dry && (
            <p className="text-sm text-[var(--muted)]">{dry.matchedPeople} matched existing people · {dry.createdPeople} new ({dry.createdStudents} students, {dry.createdMentors} mentors).</p>
          )}
          {dry && dry.roleChanges.length > 0 && (
            <div role="alert" className="flex flex-col gap-1 rounded-md border border-[var(--absent)] p-3 text-sm">
              <strong>{dry.roleChanges.length} matched {dry.roleChanges.length === 1 ? "person" : "people"} will change role.</strong>
              <span className="text-[var(--muted)]">Importing applies these. If any are wrong, fix them manually first, then re-preview.</span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {dry.roleChanges.map((c, i) => (
                  <li key={i}>{c.name}: <span className="text-[var(--muted)]">{c.from}</span> → <strong>{c.to}</strong></li>
                ))}
              </ul>
            </div>
          )}
          {outOfRange.length > 0 && selectedPeriod && (
            <p role="alert" className="text-sm text-[var(--absent)]">
              {outOfRange.length} of {preview.dates.length} meeting dates fall outside {selectedPeriod.name} ({selectedPeriod.startsOn} – {selectedPeriod.endsOn}). Did you pick the right season?
            </p>
          )}
          {preview.fileIssues.length > 0 && <ul className="text-sm text-[var(--absent)]">{preview.fileIssues.map((f, i) => <li key={i}>{f}</li>)}</ul>}
          {counts.anomalies > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {preview.people.flatMap((p) => p.anomalies.map((a, i) => (
                <li key={`${p.sourceRow}-${i}`} className="text-[var(--absent)]">{p.firstName} {p.lastName} · {a.date}: {a.detail}</li>
              )))}
            </ul>
          )}
        </section>
      )}

      {summary && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold">3. Result</h2>
          <div className="flex flex-wrap gap-2">
            <span className="pill new">{summary.sessions} sessions</span>
            <span className="pill">{summary.excusals} excusals</span>
            <span className="pill new">{summary.createdPeople} created</span>
            <span className="pill update">{summary.roleChanges.length} roles changed</span>
            <span className="pill update">{summary.skipped.length} skipped</span>
            <span className="pill error">{summary.errors.length} errors</span>
          </div>
          {summary.createdNames.length > 0 && (
            <p className="text-sm text-[var(--muted)]">
              New people ({summary.createdStudents} students, {summary.createdMentors} mentors — review): {summary.createdNames.join(", ")}
            </p>
          )}
          {summary.roleChanges.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-sm">
              {summary.roleChanges.map((c, i) => (
                <li key={i}>{c.name}: <span className="text-[var(--muted)]">{c.from}</span> → <strong>{c.to}</strong>{summary.roleChangesApplied ? "" : " (not applied)"}</li>
              ))}
            </ul>
          )}
          {summary.errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {summary.errors.map((e, i) => <li key={i} className="text-[var(--absent)]">{e.name}: {e.message}</li>)}
            </ul>
          )}
          {summary.anomalies.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {summary.anomalies.map((a, i) => (
                <li key={i} className="text-[var(--absent)]">{a.name} · {a.date}: {a.detail}</li>
              ))}
            </ul>
          )}
          {summary.skipped.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer">{summary.skipped.length} skipped entries</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {summary.skipped.map((s, i) => (
                  <li key={i} className="text-[var(--muted)]">{s.name} · {s.date}: {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
