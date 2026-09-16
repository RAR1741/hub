import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { getTeamTimezone } from "@/lib/settings";
import { SYNC_SOURCES, SYNC_SOURCE_LABELS, parseSyncRunFilter, listSyncRuns } from "@/lib/sync-runs";
import { RunNowButtons } from "@/components/RunNowButtons";

export const metadata: Metadata = { title: "Sync Runs" };

function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatDetail(detail: Record<string, number> | null): string {
  if (!detail) return "—";
  return Object.entries(detail)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

export default async function AdminSyncRunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const rawParams = await searchParams;
  const filter = parseSyncRunFilter(rawParams);
  const db = getDb();
  const [{ runs, hasMore }, teamTz] = await Promise.all([listSyncRuns(filter, db), getTeamTimezone(db)]);

  // Preserve the active filters across pagination links, only replacing `page`.
  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (filter.source) params.set("source", filter.source);
    if (filter.ok !== undefined) params.set("ok", String(filter.ok));
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/admin/sync-runs?${qs}` : "/admin/sync-runs";
  }

  const hasFilters = filter.source !== undefined || filter.ok !== undefined || filter.from !== undefined || filter.to !== undefined;

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Sync runs</h1>
          <div className="sub">History of every integration sync</div>
        </div>
      </div>

      <section className="card flex flex-col gap-4">
        <RunNowButtons />
      </section>

      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="sync-runs-source">Source</label>
          <select id="sync-runs-source" className="input" name="source" defaultValue={filter.source ?? ""}>
            <option value="">All</option>
            {SYNC_SOURCES.map((s) => (
              <option key={s.source} value={s.source}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sync-runs-ok">Status</label>
          <select
            id="sync-runs-ok"
            className="input"
            name="ok"
            defaultValue={filter.ok === undefined ? "" : String(filter.ok)}
          >
            <option value="">All</option>
            <option value="true">Success</option>
            <option value="false">Failed</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sync-runs-from">From</label>
          <input id="sync-runs-from" className="input" type="date" name="from" defaultValue={filter.from ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="sync-runs-to">To</label>
          <input id="sync-runs-to" className="input" type="date" name="to" defaultValue={filter.to ?? ""} />
        </div>
        <button type="submit" className="btn btn-primary">Apply</button>
      </form>

      {runs.length === 0 ? (
        <p className="card text-[var(--muted)]">
          {hasFilters ? "No sync runs match these filters." : "No syncs have run since this was deployed."}
        </p>
      ) : (
        <div className="tablewrap">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Finished</th>
                  <th>Duration</th>
                  <th>Changes</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{SYNC_SOURCE_LABELS[r.source]}</td>
                    <td className={r.ok ? undefined : "text-[var(--red)]"}>{r.ok ? "ok" : "failed"}</td>
                    <td className="mono">{new Date(r.finishedAt).toLocaleString(undefined, { timeZone: teamTz })}</td>
                    <td className="mono">{formatDuration(r.startedAt, r.finishedAt)}</td>
                    <td className="text-sm">{formatDetail(r.detail)}</td>
                    <td className="text-sm">
                      {r.error ? (
                        <details>
                          <summary>{r.error.split("\n")[0]}</summary>
                          <pre className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {r.error}
                          </pre>
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        {filter.page > 1 && (
          <Link href={pageHref(filter.page - 1)} className="btn">Newer</Link>
        )}
        {hasMore && <Link href={pageHref(filter.page + 1)} className="btn">Older</Link>}
      </div>
    </main>
  );
}
