import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSource } from "./slack-alerts";

export const SYNC_SOURCES: { source: AlertSource; label: string; endpoint: string }[] = [
  { source: "first_sync", label: "FIRST roster sync", endpoint: "/api/admin/first/sync" },
  { source: "calendar_sync", label: "Google Calendar sync", endpoint: "/api/admin/calendar/sync" },
  { source: "drive_sync", label: "Google Drive group sync", endpoint: "/api/admin/drive-group/sync" },
  { source: "github_sync", label: "GitHub team sync", endpoint: "/api/admin/github-team/sync" },
  { source: "slack_sync", label: "Slack membership sync", endpoint: "/api/cron/slack/membership-sync" },
];

export const SYNC_SOURCE_LABELS: Record<AlertSource, string> = Object.fromEntries(
  SYNC_SOURCES.map(({ source, label }) => [source, label]),
) as Record<AlertSource, string>;

export type SyncRun = {
  id: string;
  source: AlertSource;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  error: string | null;
  detail: Record<string, number> | null;
};

export type SyncRunFilter = { source?: AlertSource; ok?: boolean; from?: string; to?: string; page: number };

export const SYNC_RUN_PAGE_SIZE = 50;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = new Set(SYNC_SOURCES.map((s) => s.source));

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Real calendar date, not just the right shape: "2026-01-32" matches the regex but
 *  Date rolls it over to Feb 1, so require the parse to round-trip unchanged. */
function isValidDay(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate raw searchParams → SyncRunFilter. PURE. Arrays take the first element; unknown
 *  source / ok not in {"true","false"} / dates that are not real calendar days are dropped;
 *  page = positive int, else 1. */
export function parseSyncRunFilter(params: Record<string, string | string[] | undefined>): SyncRunFilter {
  const filter: SyncRunFilter = { page: 1 };

  const source = first(params.source);
  if (source !== undefined && SOURCES.has(source as AlertSource)) filter.source = source as AlertSource;

  const ok = first(params.ok);
  if (ok === "true") filter.ok = true;
  else if (ok === "false") filter.ok = false;

  const from = first(params.from);
  if (from !== undefined && isValidDay(from)) filter.from = from;

  const to = first(params.to);
  if (to !== undefined && isValidDay(to)) filter.to = to;

  const page = first(params.page);
  const pageNum = page !== undefined ? Number(page) : NaN;
  if (Number.isInteger(pageNum) && pageNum > 0) filter.page = pageNum;

  return filter;
}

/** Newest first. Fetches PAGE_SIZE+1 rows and reports hasMore instead of a count query. Throws on db error. */
export async function listSyncRuns(
  filter: SyncRunFilter,
  db: SupabaseClient,
): Promise<{ runs: SyncRun[]; hasMore: boolean }> {
  const offset = (filter.page - 1) * SYNC_RUN_PAGE_SIZE;

  let query = db.from("sync_run").select("*");
  if (filter.source !== undefined) query = query.eq("source", filter.source);
  if (filter.ok !== undefined) query = query.eq("ok", filter.ok);
  if (filter.from !== undefined) query = query.gte("finished_at", filter.from);
  if (filter.to !== undefined) {
    const toExclusive = new Date(`${filter.to}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    query = query.lt("finished_at", toExclusive.toISOString());
  }

  const { data, error } = await query
    .order("finished_at", { ascending: false })
    .range(offset, offset + SYNC_RUN_PAGE_SIZE);
  if (error) throw error;

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > SYNC_RUN_PAGE_SIZE;
  const runs = rows.slice(0, SYNC_RUN_PAGE_SIZE).map((row) => ({
    id: row.id as string,
    source: row.source as AlertSource,
    ok: row.ok as boolean,
    startedAt: row.started_at as string,
    finishedAt: row.finished_at as string,
    error: row.error as string | null,
    detail: row.detail as Record<string, number> | null,
  }));

  return { runs, hasMore };
}

/** Never throws is the CALLER's job (reportSyncOutcome wraps it); this checks `error` and throws. */
export async function insertSyncRun(
  row: {
    source: AlertSource;
    ok: boolean;
    startedAt: number;
    error: string | null;
    detail: Record<string, number> | null;
  },
  db: SupabaseClient,
): Promise<void> {
  const { error } = await db.from("sync_run").insert({
    source: row.source,
    ok: row.ok,
    started_at: new Date(row.startedAt).toISOString(),
    error: row.error,
    detail: row.detail,
  });
  if (error) throw error;
}
