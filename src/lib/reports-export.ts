/**
 * RFC-4180-ish CSV encoding: quote a field when it contains a comma, a
 * double quote, or a newline; double any embedded quote; CRLF line endings;
 * header row first. `null` becomes an empty field (not the string "null").
 * PURE.
 */
function csvField(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(","));
  return lines.map((line) => `${line}\r\n`).join("");
}

export type HoursReportCsvRow = { name: string; studentId: string | null; hours: number };

/** PURE. */
export function hoursReportCsv(rows: HoursReportCsvRow[]): string {
  return toCsv(
    ["Name", "Student ID", "Hours"],
    rows.map((r) => [r.name, r.studentId, r.hours]),
  );
}

export type AttendanceSummaryCsvRow = {
  name: string;
  present: number;
  excused: number;
  absent: number;
  requiredDays: number;
  pct: number | null;
};

/** PURE. */
export function attendanceSummaryCsv(rows: AttendanceSummaryCsvRow[]): string {
  return toCsv(
    ["Name", "Present", "Excused", "Absent", "Required Days", "Percent"],
    rows.map((r) => [r.name, r.present, r.excused, r.absent, r.requiredDays, r.pct]),
  );
}
