"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApplicationDecision, ApplicationImportSummary } from "@/lib/application-import-run";

export function ApplicationImportForm() {
  const [text, setText] = useState("");
  const [dry, setDry] = useState<ApplicationImportSummary | null>(null);
  // The exact text a successful preview was run for — Import is gated on this matching.
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);
  // Per-needsDecision-key choice: "create" | "skip" | `link:${personId}`.
  const [decisions, setDecisions] = useState<Record<string, ApplicationDecision>>({});
  const [summary, setSummary] = useState<ApplicationImportSummary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Any change to the file invalidates a prior preview — you must re-glance before importing.
  function resetPreview() {
    setDry(null); setPreviewedFor(null); setSummary(null); setStatus(null); setDecisions({});
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result ?? "")); resetPreview(); };
    reader.readAsText(file);
  }

  const importReady = !!previewedFor && previewedFor === text;
  const allDecided = !!dry && dry.needsDecision.every((d) => decisions[d.key]);

  async function doPreview() {
    setBusy(true); setStatus(null); setSummary(null);
    try {
      const res = await fetch("/api/admin/application-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      if (res.ok) {
        setDry((await res.json()) as ApplicationImportSummary);
        setPreviewedFor(text);
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
      const res = await fetch("/api/admin/application-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, confirm: true, decisions }),
      });
      if (res.ok) {
        const data = (await res.json()) as ApplicationImportSummary;
        setSummary(data);
        setStatus(
          `Imported ${data.created.length} created, ${data.matched.length} matched · ${data.guardiansCreated} guardians created, ${data.guardiansMatched} matched · ${data.experienceRows} experience rows · ${data.skipped.length} skipped, ${data.stale.length} stale, ${data.errors.length} errors · ${data.deactivated} deactivated.`,
        );
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
        <h2 className="text-base font-semibold">1. Choose a file</h2>
        <label className="label">
          Upload CSV
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary" onClick={doPreview} disabled={busy || !text.trim()}>
            {busy && !summary ? "Previewing…" : "Preview"}
          </button>
          <button type="button" className="btn btn-primary" onClick={runImport} disabled={busy || !importReady || !allDecided} title={importReady ? undefined : "Preview first"}>
            {busy && summary === null && importReady ? "Importing…" : "Import"}
          </button>
          {!importReady && <span className="text-sm text-[var(--muted)]">Preview first — review the summary below before importing.</span>}
          {importReady && !allDecided && <span className="text-sm text-[var(--absent)]">Decide every fuzzy match before importing.</span>}
        </div>
        {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
      </section>

      {dry && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold">2. Preview</h2>
          <div className="flex flex-wrap gap-2">
            <span className="pill new">{dry.created.length} to create</span>
            <span className="pill">{dry.matched.length} matched</span>
            <span className="pill update">{dry.skipped.length} skipped</span>
            <span className="pill">{dry.stale.length} stale</span>
            <span className="pill error">{dry.anomalies.length} anomalies</span>
            <span className="pill error">{dry.errors.length} errors</span>
            <span className="pill update">{dry.wouldDeactivate} would deactivate</span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Guardians: {dry.guardiansCreated} created, {dry.guardiansMatched} matched · {dry.experienceRows} experience rows.
          </p>

          {dry.created.length > 0 && (
            <p className="text-sm text-[var(--muted)]">New applicants: {dry.created.join(", ")}</p>
          )}

          {dry.matched.length > 0 && (
            <div className="flex flex-col gap-1">
              <strong className="text-sm">Matched — field changes</strong>
              <ul className="flex flex-col gap-1 text-sm">
                {dry.matched.map((m, i) => (
                  <li key={i}>
                    {m.name}
                    {m.changes.length === 0 ? (
                      <span className="text-[var(--muted)]"> — no changes</span>
                    ) : (
                      <ul className="ml-4 flex flex-col gap-0.5">
                        {m.changes.map((c, j) => (
                          <li key={j} className="text-[var(--muted)]">
                            {c.field}: <span>{String(c.from ?? "—")}</span> → <strong>{String(c.to ?? "—")}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dry.roleCallouts.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {dry.roleCallouts.map((r, i) => (
                <li key={i} className="text-[var(--absent)]">{r.name} is a {r.role} — role will not change.</li>
              ))}
            </ul>
          )}

          {dry.needsDecision.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-[var(--absent)] p-3">
              <p className="text-sm">
                <strong>{dry.needsDecision.length} applicant{dry.needsDecision.length === 1 ? "" : "s"} need a decision</strong>
                {" — link to an existing person, create new, or skip. Decide each before importing."}
              </p>
              <ul className="flex flex-col gap-2">
                {dry.needsDecision.map((d) => {
                  const decide = (v: ApplicationDecision) => () => setDecisions((cur) => ({ ...cur, [d.key]: v }));
                  const cls = (v: string) => "btn " + (decisions[d.key] === v ? "btn-primary" : "btn-secondary");
                  return (
                    <li key={d.key} className="flex flex-col gap-1 text-sm">
                      <span className="text-[var(--absent)]">{d.applicant}</span>
                      <span className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Decision for ${d.applicant}`}>
                        {d.candidates.map((c) => (
                          <button
                            key={c.personId}
                            type="button"
                            role="radio"
                            aria-checked={decisions[d.key] === `link:${c.personId}`}
                            className={cls(`link:${c.personId}`)}
                            onClick={decide(`link:${c.personId}`)}
                          >
                            Link to {c.name}
                          </button>
                        ))}
                        <button type="button" role="radio" aria-checked={decisions[d.key] === "create"} className={cls("create")} onClick={decide("create")}>Create new</button>
                        <button type="button" role="radio" aria-checked={decisions[d.key] === "skip"} className={cls("skip")} onClick={decide("skip")}>Skip</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {dry.stale.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {dry.stale.map((s, i) => <li key={i} className="text-[var(--muted)]">{s.name}: skipped — a newer application was already imported.</li>)}
            </ul>
          )}
          {dry.skipped.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {dry.skipped.map((s, i) => <li key={i} className="text-[var(--muted)]">{s.name}: {s.reason}</li>)}
            </ul>
          )}
          {dry.anomalies.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer">{dry.anomalies.length} anomalies</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {dry.anomalies.map((a, i) => <li key={i} className="text-[var(--absent)]">{a.name} · {a.field}: {a.detail}</li>)}
              </ul>
            </details>
          )}
          {dry.errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {dry.errors.map((e, i) => <li key={i} className="text-[var(--absent)]">{e.name}: {e.message}</li>)}
            </ul>
          )}
        </section>
      )}

      {summary && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold">3. Result</h2>
          <div className="flex flex-wrap gap-2">
            <span className="pill new">{summary.created.length} created</span>
            <span className="pill">{summary.matched.length} matched</span>
            <span className="pill update">{summary.skipped.length} skipped</span>
            <span className="pill">{summary.stale.length} stale</span>
            <span className="pill error">{summary.errors.length} errors</span>
            <span className="pill update">{summary.deactivated} deactivated</span>
          </div>
          {summary.created.length > 0 && (
            <p className="text-sm text-[var(--muted)]">New people (review): {summary.created.join(", ")}</p>
          )}
          {summary.errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {summary.errors.map((e, i) => <li key={i} className="text-[var(--absent)]">{e.name}: {e.message}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
