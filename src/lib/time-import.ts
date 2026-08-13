import { parseCsvRecords } from "./csv";
import {
  MAX_SHIFT_MIN,
  TIME_ANOMALY_THRESHOLD_MIN,
  median,
  parseClockToken,
  resolveColumnTimes,
  type ClockParse,
  type ResolvedCell,
} from "./time-parse";

export type ParsedSession = { date: string; timeIn: string; timeOut: string; timeOutDate: string };
export type ParsedExcusal = { date: string };
export type SkippedEntry = { date: string; reason: string };
export type TimeAnomaly = {
  date: string;
  kind: "time_far_from_column" | "over_max_shift" | "zero_or_negative";
  detail: string;
};
export type ParsedPerson = {
  firstName: string;
  lastName: string;
  sourceRow: number;
  sessions: ParsedSession[];
  excusals: ParsedExcusal[];
  skipped: SkippedEntry[];
  anomalies: TimeAnomaly[];
};
export type ParsedTimeSheet = { dates: string[]; people: ParsedPerson[]; fileIssues: string[] };

const BLOCK_START = 3; // cols 0,1,2 = first, last, hours-left
const BLOCK_STRIDE = 3; // [Time In, Time Out, ignored]

/** "January 8, 2026" -> "2026-01-08", else null. PURE. */
function parseSheetDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function nextDay(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

const cell = (rec: string[], i: number): string => (rec[i] ?? "").trim();

/**
 * Resolve a Time-Out cell. Row-aware: for an ambiguous (bare small-hour) out,
 * prefer whichever AM/PM reading yields a sensible shift (0 < duration <=
 * MAX_SHIFT_MIN) against this row's resolved Time-In — so a real overnight out
 * (e.g. "1:00" after an 18:00 in => 1 AM, 7h) resolves correctly instead of
 * being read as PM by column consensus. Falls back to column consensus (nearest
 * the confident median) when both or neither reading is sensible, or when the
 * Time-In is unknown. A row-aware pick is trusted (never flagged far-from-column). PURE.
 */
function resolveOutCell(out: ClockParse, inMinutes: number | null, columnMedian: number | null): ResolvedCell {
  if (out.kind === "confident") {
    return { minutes: out.minutes, farFromColumn: columnMedian !== null && Math.abs(out.minutes - columnMedian) > TIME_ANOMALY_THRESHOLD_MIN };
  }
  if (out.kind === "ambiguous") {
    if (inMinutes !== null) {
      const dur = (c: number) => (c < inMinutes ? c + 1440 : c) - inMinutes;
      const amOk = dur(out.am) > 0 && dur(out.am) <= MAX_SHIFT_MIN;
      const pmOk = dur(out.pm) > 0 && dur(out.pm) <= MAX_SHIFT_MIN;
      if (amOk && !pmOk) return { minutes: out.am, farFromColumn: false };
      if (pmOk && !amOk) return { minutes: out.pm, farFromColumn: false };
    }
    const chosen = columnMedian === null || Math.abs(out.am - columnMedian) <= Math.abs(out.pm - columnMedian) ? out.am : out.pm;
    return { minutes: chosen, farFromColumn: columnMedian !== null && Math.abs(chosen - columnMedian) > TIME_ANOMALY_THRESHOLD_MIN };
  }
  return { minutes: null, farFromColumn: false };
}

export function parseTimeSheet(csvText: string): ParsedTimeSheet {
  const records = parseCsvRecords(csvText);
  const fileIssues: string[] = [];

  // 1. Date row = first row with >= 3 stride-3 cells parsing as dates.
  let dateRowIdx = -1;
  for (let r = 0; r < records.length; r++) {
    let count = 0;
    for (let c = BLOCK_START; c < records[r].length; c += BLOCK_STRIDE) {
      if (parseSheetDate(cell(records[r], c))) count++;
    }
    if (count >= 3) { dateRowIdx = r; break; }
  }
  if (dateRowIdx === -1) return { dates: [], people: [], fileIssues: ["No date row found"] };

  // 2. Blocks: consecutive stride-3 date cells from BLOCK_START until the first gap.
  const blocks: { col: number; date: string }[] = [];
  for (let c = BLOCK_START; c < records[dateRowIdx].length; c += BLOCK_STRIDE) {
    const date = parseSheetDate(cell(records[dateRowIdx], c));
    if (!date) break;
    blocks.push({ col: c, date });
  }
  const dates = blocks.map((b) => b.date);

  // 3. Data rows = rows after the date row with both name cells non-empty.
  const dataRows: { rec: string[]; sourceRow: number }[] = [];
  for (let r = dateRowIdx + 1; r < records.length; r++) {
    const first = cell(records[r], 0);
    const last = cell(records[r], 1);
    if (first && last) dataRows.push({ rec: records[r], sourceRow: r + 1 }); // 1-based line
  }
  if (dataRows.length === 0) fileIssues.push("No data rows found");

  // 4. Per-column consensus for Time-In and Time-Out sub-columns.
  const inResolved: ResolvedCell[][] = blocks.map((b) =>
    resolveColumnTimes(dataRows.map(({ rec }) => parseClockToken(cell(rec, b.col)))),
  );
  const outResolved: ResolvedCell[][] = blocks.map((b, blockIdx) => {
    const outParses = dataRows.map(({ rec }) => parseClockToken(cell(rec, b.col + 1)));
    const columnMedian = median(outParses.flatMap((p) => (p.kind === "confident" ? [p.minutes] : [])));
    return outParses.map((op, personIdx) => resolveOutCell(op, inResolved[blockIdx][personIdx].minutes, columnMedian));
  });

  const people: ParsedPerson[] = dataRows.map(({ rec, sourceRow }, personIdx) => {
    const person: ParsedPerson = {
      firstName: cell(rec, 0),
      lastName: cell(rec, 1),
      sourceRow,
      sessions: [],
      excusals: [],
      skipped: [],
      anomalies: [],
    };

    blocks.forEach((b, blockIdx) => {
      const { date } = b;
      const inRaw = parseClockToken(cell(rec, b.col));
      if (inRaw.kind === "excused") {
        person.excusals.push({ date });
        return;
      }
      const inCell = inResolved[blockIdx][personIdx];
      const outCell = outResolved[blockIdx][personIdx];

      if (inCell.minutes !== null && outCell.minutes !== null) {
        const overnight = outCell.minutes < inCell.minutes;
        const durMin = outCell.minutes + (overnight ? 1440 : 0) - inCell.minutes;
        person.sessions.push({
          date,
          timeIn: hhmm(inCell.minutes),
          timeOut: hhmm(outCell.minutes),
          timeOutDate: overnight ? nextDay(date) : date,
        });
        if (inCell.farFromColumn) person.anomalies.push({ date, kind: "time_far_from_column", detail: `Time In ${hhmm(inCell.minutes)} is far from the column norm` });
        if (outCell.farFromColumn) person.anomalies.push({ date, kind: "time_far_from_column", detail: `Time Out ${hhmm(outCell.minutes)} is far from the column norm` });
        if (durMin <= 0) person.anomalies.push({ date, kind: "zero_or_negative", detail: "Session has zero or negative length" });
        else if (durMin > MAX_SHIFT_MIN) person.anomalies.push({ date, kind: "over_max_shift", detail: `Session is ${(durMin / 60).toFixed(1)}h (over ${MAX_SHIFT_MIN / 60}h)` });
      } else if (inCell.minutes !== null && outCell.minutes === null) {
        person.skipped.push({ date, reason: "missing clock-out" });
      } else if (inCell.minutes === null && outCell.minutes !== null) {
        person.skipped.push({ date, reason: "missing clock-in" });
      }
      // both null and not excused -> plain absence, nothing recorded
    });

    return person;
  });

  return { dates, people, fileIssues };
}
