/**
 * Pure CSV roster parser — no DB access. Used both client-side (import
 * preview) and server-side (the admin import route re-validates from the raw
 * text; it never trusts a client-computed preview).
 *
 * Header: first_name,last_name,email,role,grad_year,student_id_number
 * (case-insensitive, any order). first_name + last_name are required; the
 * rest are optional. Unknown columns are ignored (noted, not fatal).
 */

export type RosterRole = "admin" | "mentor" | "student";

export type ParsedRosterRow = {
  /** 1-based line number in the source text (header is line 1). */
  line: number;
  firstName: string;
  lastName: string;
  email: string | null;
  role: RosterRole;
  /**
   * False when the row's `role` cell was blank and `role` was defaulted to
   * "student" rather than explicitly stated. An update-matched row should
   * not use a defaulted role to overwrite an existing mentor/admin — see
   * `updatePersonRosterFields` in `src/lib/people.ts`.
   */
  roleWasSpecified: boolean;
  gradYear: number | null;
  studentIdNumber: string | null;
};

export type RosterRowError = {
  line: number;
  message: string;
};

export type ParseRosterCsvResult = {
  rows: ParsedRosterRow[];
  errors: RosterRowError[];
};

const KNOWN_HEADERS = [
  "first_name",
  "last_name",
  "email",
  "role",
  "grad_year",
  "student_id_number",
] as const;
type HeaderKey = (typeof KNOWN_HEADERS)[number];

const ROLE_VALUES = ["admin", "mentor", "student"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * RFC4180-ish CSV tokenizer: quoted fields, doubled-quote escaping, embedded
 * commas inside quotes, and CRLF/CR/LF line endings. Deliberately small and
 * dependency-free per the brief (no heavy CSV package needed for this shape).
 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyContentInRow = false;

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let i = 0;
  const len = src.length;

  while (i < len) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      sawAnyContentInRow = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      sawAnyContentInRow = true;
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      sawAnyContentInRow = false;
      i++;
      continue;
    }
    field += c;
    sawAnyContentInRow = true;
    i++;
  }

  if (sawAnyContentInRow || field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records;
}

function cellOrEmpty(record: string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  return (record[idx] ?? "").trim();
}

/** PURE. Parses + validates roster CSV text. Never throws. */
export function parseRosterCsv(text: string): ParseRosterCsvResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { rows: [], errors: [] };

  const headerRecord = records[0];
  const headerIndex = new Map<HeaderKey, number>();
  const unknownColumns: string[] = [];

  headerRecord.forEach((raw, idx) => {
    const key = raw.trim().toLowerCase();
    if (key === "") return;
    if ((KNOWN_HEADERS as readonly string[]).includes(key)) {
      headerIndex.set(key as HeaderKey, idx);
    } else {
      unknownColumns.push(raw.trim());
    }
  });

  const errors: RosterRowError[] = [];
  if (unknownColumns.length > 0) {
    errors.push({
      line: 1,
      message: `Ignored unrecognized column(s): ${unknownColumns.join(", ")}`,
    });
  }

  if (!headerIndex.has("first_name") || !headerIndex.has("last_name")) {
    errors.push({
      line: 1,
      message: "Missing required column(s): first_name, last_name",
    });
    return { rows: [], errors };
  }

  const dataRecords = records.slice(1);

  type Candidate = ParsedRosterRow;
  const candidates: Candidate[] = [];

  dataRecords.forEach((record, i) => {
    const line = i + 2; // header occupies line 1

    // Skip fully-blank trailing lines some spreadsheet exports leave behind.
    if (record.length === 1 && record[0].trim() === "") return;

    const get = (key: HeaderKey) => cellOrEmpty(record, headerIndex.get(key));

    const firstName = get("first_name");
    const lastName = get("last_name");
    if (!firstName || !lastName) {
      errors.push({ line, message: "first_name and last_name are both required" });
      return;
    }

    const roleRaw = get("role");
    let role: RosterRole;
    const roleWasSpecified = roleRaw !== "";
    if (!roleWasSpecified) {
      role = "student";
    } else {
      const normalized = roleRaw.toLowerCase();
      const found = ROLE_VALUES.find((r) => r === normalized);
      if (!found) {
        errors.push({ line, message: `Unknown role: "${roleRaw}" (expected admin, mentor, or student)` });
        return;
      }
      role = found;
    }

    const gradYearRaw = get("grad_year");
    let gradYear: number | null = null;
    if (gradYearRaw !== "") {
      const n = Number(gradYearRaw);
      // Bound to the same range the admin person form enforces (optInt 2000–2100)
      // so a typo'd year (e.g. 20281) is caught instead of imported.
      if (!Number.isInteger(n) || n < 2000 || n > 2100) {
        errors.push({
          line,
          message: `grad_year must be an integer between 2000 and 2100: "${gradYearRaw}"`,
        });
        return;
      }
      gradYear = n;
    }

    const emailRaw = get("email");
    let email: string | null = null;
    if (emailRaw !== "") {
      const lowered = emailRaw.toLowerCase();
      if (!EMAIL_RE.test(lowered)) {
        errors.push({ line, message: `Invalid email: "${emailRaw}"` });
        return;
      }
      email = lowered;
    }

    const studentIdRaw = get("student_id_number");
    const studentIdNumber = studentIdRaw !== "" ? studentIdRaw : null;

    candidates.push({ line, firstName, lastName, email, role, roleWasSpecified, gradYear, studentIdNumber });
  });

  // In-file duplicate detection (by email, case-insensitively — already
  // lowercased above — and by student_id_number). Every row sharing a key
  // becomes an error and is excluded from the importable rows: there's no
  // safe way to pick a "winner" among them.
  const byEmail = new Map<string, number[]>();
  const byStudentId = new Map<string, number[]>();
  for (const c of candidates) {
    if (c.email) byEmail.set(c.email, [...(byEmail.get(c.email) ?? []), c.line]);
    if (c.studentIdNumber) {
      byStudentId.set(c.studentIdNumber, [...(byStudentId.get(c.studentIdNumber) ?? []), c.line]);
    }
  }

  const dupLines = new Set<number>();
  for (const [email, lines] of byEmail) {
    if (lines.length < 2) continue;
    for (const line of lines) {
      dupLines.add(line);
      const others = lines.filter((l) => l !== line);
      errors.push({
        line,
        message: `Duplicate email "${email}" also appears on line ${others.join(", ")}`,
      });
    }
  }
  for (const [sid, lines] of byStudentId) {
    if (lines.length < 2) continue;
    for (const line of lines) {
      dupLines.add(line);
      const others = lines.filter((l) => l !== line);
      errors.push({
        line,
        message: `Duplicate student_id_number "${sid}" also appears on line ${others.join(", ")}`,
      });
    }
  }

  const rows = candidates.filter((c) => !dupLines.has(c.line));
  errors.sort((a, b) => a.line - b.line);

  return { rows, errors };
}
