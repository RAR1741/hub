// src/lib/application-parse.ts
/**
 * Pure parser for the Google-Forms "Student Application" CSV export.
 *
 * Headers drift year to year (columns move, appear, disappear), so every
 * field is located by matching NORMALIZED header text against canonical
 * snippets rather than by fixed column index. See
 * .superpowers/sdd/2026-08-14-application-import/task-2-brief.md.
 */
import { parseCsvRecords } from "./csv";

export type FirstExperienceLevel = "fll_explore" | "fll_challenge" | "ftc" | "frc";

export type ParsedGuardian = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  relationship: string | null;
};

export type ParsedExperience = { level: FirstExperienceLevel; year: number; name: string | null };

export type ParsedApplication = {
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  gradYear: number | null;
  dob: string | null; // ISO yyyy-mm-dd or null
  school: string | null;
  streetAddress: string | null;
  city: string | null;
  zip: string | null;
  homePhone: string | null;
  phone: string | null;
  shirtSize: string | null;
  ethnicity: string | null;
  race: string | null;
  dietaryRestrictions: string | null;
  interests: string[];
  guardians: ParsedGuardian[];
  experiences: ParsedExperience[];
  submittedAt: string | null; // ISO timestamp parsed from the Timestamp column; null if unparseable
};

export type ApplicationAnomaly = { rowIndex: number; name: string; field: string; detail: string; raw?: string };

export type ApplicationParseResult = {
  seasonYear: number | null; // from the "20XX-20YY School Year" header → the second year (YY)
  applications: ParsedApplication[];
  anomalies: ApplicationAnomaly[];
};

/** lowercase + trim each part, join with a printable separator ("|"). */
export function nameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeValue(v: string | undefined): string {
  return (v ?? "").trim();
}

function nullIfEmptyOrNA(v: string): string | null {
  const t = v.trim();
  if (t === "" || t.toLowerCase() === "n/a") return null;
  return t;
}

function normalizeEmail(v: string): string | null {
  const t = nullIfEmptyOrNA(v);
  // The person/guardian tables enforce email = lower(email); emails are
  // case-insensitive, so lowercasing here is both correct and required.
  return t === null ? null : t.toLowerCase();
}

function normalizePhone(v: string): string | null {
  const t = v.trim();
  if (t === "" || t.toLowerCase() === "n/a") return null;
  const digits = t.replace(/[^0-9]/g, "");
  return digits === "" ? null : digits;
}

type ColumnMap = {
  timestamp: number | null;
  firstName: number | null;
  preferredName: number | null;
  lastName: number | null;
  dob: number | null;
  gradYear: number | null;
  school: number | null;
  streetAddress: number | null;
  city: number | null;
  zip: number | null;
  homePhone: number | null;
  phone: number | null;
  email: number | null;
  shirtSize: number | null;
  ethnicity: number | null;
  race: number | null;
  interests: number | null;
  dietaryRestrictions: number | null;
  g1FirstName: number | null;
  g1LastName: number | null;
  g1Relationship: number | null;
  g1Phone: number | null;
  g1Email: number | null;
  g1Employer: number | null;
  g2FirstName: number | null;
  g2LastName: number | null;
  g2Relationship: number | null;
  g2Phone: number | null;
  g2Email: number | null;
  g2Employer: number | null;
  fllExplore: number | null;
  fllChallenge: number | null;
  ftc: number | null;
  frc: number | null;
  seasonYear: number | null;
};

function findIndex(normalized: string[], pred: (h: string) => boolean): number | null {
  const idx = normalized.findIndex(pred);
  return idx === -1 ? null : idx;
}

function buildColumnMap(headerRow: string[]): ColumnMap {
  const normalized = headerRow.map(normalizeHeader);

  const isGuardian2 = (h: string) => h.includes("guardian 2");
  const isGuardian1Only = (h: string) => h.includes("guardian") && !isGuardian2(h);

  const map: ColumnMap = {
    timestamp: findIndex(normalized, (h) => h.includes("timestamp")),
    // exact match to avoid matching "parent/guardian first name" etc.
    firstName: findIndex(normalized, (h) => h === "first name"),
    preferredName: findIndex(normalized, (h) => h.includes("preferred name")),
    lastName: findIndex(normalized, (h) => h === "last name"),
    dob: findIndex(normalized, (h) => h.includes("date of birth")),
    gradYear: findIndex(normalized, (h) => h.includes("graduation year")),
    school: findIndex(normalized, (h) => h.startsWith("what school are you attending")),
    streetAddress: findIndex(normalized, (h) => h.includes("street address")),
    city: findIndex(normalized, (h) => h === "city"),
    zip: findIndex(normalized, (h) => h.includes("zip code")),
    homePhone: findIndex(normalized, (h) => h.includes("home phone")),
    phone: findIndex(normalized, (h) => h.includes("cell phone") && !h.includes("guardian")),
    email: findIndex(normalized, (h) => h.includes("email address") && !h.includes("guardian")),
    shirtSize: findIndex(normalized, (h) => h.includes("t-shirt size")),
    ethnicity: findIndex(normalized, (h) => h.includes("your ethnicity")),
    race: findIndex(normalized, (h) => h.includes("your race")),
    interests: findIndex(normalized, (h) => h.includes("items of interest")),
    // 2025 quirk: a single trailing UNLABELED header holds allergy text.
    dietaryRestrictions: findIndex(normalized, (h) => h === ""),

    g1FirstName: findIndex(normalized, (h) => isGuardian1Only(h) && h.includes("first name")),
    g1LastName: findIndex(normalized, (h) => isGuardian1Only(h) && h.includes("last name")),
    g1Relationship: findIndex(normalized, (h) => isGuardian1Only(h) && h.includes("relationship")),
    g1Phone: findIndex(normalized, (h) => isGuardian1Only(h) && h.includes("cell phone")),
    g1Email: findIndex(normalized, (h) => isGuardian1Only(h) && h.includes("email")),
    g1Employer: findIndex(normalized, (h) => isGuardian1Only(h) && h.includes("employment")),

    // quirk: G2 first-name header is "parent/guardian 2 (if applicable)",
    // G2 last-name header is exactly "parent/guardian 2".
    g2FirstName: findIndex(normalized, (h) => h === "parent/guardian 2 (if applicable)"),
    g2LastName: findIndex(normalized, (h) => h === "parent/guardian 2"),
    g2Relationship: findIndex(normalized, (h) => isGuardian2(h) && h.includes("relationship")),
    g2Phone: findIndex(normalized, (h) => isGuardian2(h) && h.includes("cell phone")),
    g2Email: findIndex(normalized, (h) => isGuardian2(h) && h.includes("email")),
    g2Employer: findIndex(normalized, (h) => isGuardian2(h) && h.includes("employment")),

    fllExplore: findIndex(
      normalized,
      (h) => h.includes("participated as a student in") && h.includes("fll") && (h.includes("explore") || h.includes("jr")),
    ),
    fllChallenge: findIndex(
      normalized,
      (h) =>
        h.includes("participated as a student in") &&
        h.includes("fll") &&
        !(h.includes("explore") || h.includes("jr")),
    ),
    ftc: findIndex(normalized, (h) => h.includes("participated as a student in") && h.includes("ftc")),
    frc: findIndex(normalized, (h) => h.includes("participated as a student in") && h.includes("frc")),
    seasonYear: null,
  };

  return map;
}

function extractSeasonYear(headerRow: string[], map: ColumnMap): number | null {
  if (map.school === null) return null;
  const header = headerRow[map.school] ?? "";
  const m = header.match(/(\d{4})-(\d{4})/);
  if (!m) return null;
  return parseInt(m[2], 10);
}

function getCell(row: string[], idx: number | null): string {
  if (idx === null) return "";
  return normalizeValue(row[idx]);
}

function parseTimestamp(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  // Expected shape: M/D/YYYY H:M:S
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, mo, d, y, h, mi, s] = m;
  const date = new Date(
    Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), parseInt(s, 10)),
  );
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseDob(
  raw: string,
  rowIndex: number,
  name: string,
  seasonYear: number | null,
  anomalies: ApplicationAnomaly[],
): string | null {
  const t = raw.trim();
  if (t === "" || t.toLowerCase() === "n/a") return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/);
  if (!m) {
    anomalies.push({ rowIndex, name, field: "dob", detail: "unparseable date of birth", raw: t });
    return null;
  }
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const iso = `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;

  const maxPlausible = seasonYear !== null ? seasonYear - 10 : null;
  if (year < 1980 || (maxPlausible !== null && year > maxPlausible)) {
    anomalies.push({ rowIndex, name, field: "dob", detail: "implausible birth year", raw: t });
  }
  return iso;
}

function parseGradYear(
  raw: string,
  rowIndex: number,
  name: string,
  anomalies: ApplicationAnomaly[],
): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const m = t.match(/^\d{4}$/);
  if (!m) {
    anomalies.push({ rowIndex, name, field: "gradYear", detail: "graduation year is not a 4-digit number", raw: t });
    return null;
  }
  return parseInt(t, 10);
}

function parseExperienceCell(
  raw: string,
  level: FirstExperienceLevel,
  rowIndex: number,
  name: string,
  anomalies: ApplicationAnomaly[],
): ParsedExperience[] {
  const t = raw.trim();
  if (t === "") return [];
  const entries = t.split(",").map((e) => e.trim()).filter((e) => e !== "");
  const out: ParsedExperience[] = [];
  for (const entry of entries) {
    const m = entry.match(/^(\d{4})(?:-(\d{4}))?\s+(.*)$/);
    if (!m) {
      anomalies.push({
        rowIndex,
        name,
        field: `experience:${level}`,
        detail: "unparseable experience entry",
        raw: entry,
      });
      continue;
    }
    const [, y1, y2, rest] = m;
    const year = y2 ? parseInt(y2, 10) : parseInt(y1, 10);
    const experienceName = rest.trim() === "" ? null : rest.trim();
    out.push({ level, year, name: experienceName });
  }
  return out;
}

function buildGuardian(
  firstName: string,
  lastName: string,
  relationship: string,
  phone: string,
  email: string,
  employer: string,
): ParsedGuardian | null {
  const first = firstName.trim();
  const last = lastName.trim();
  if (first === "" && last === "") return null;
  return {
    firstName: first,
    lastName: last,
    email: normalizeEmail(email),
    phone: normalizePhone(phone),
    employer: nullIfEmptyOrNA(employer),
    relationship: nullIfEmptyOrNA(relationship),
  };
}

export function parseApplications(csvText: string): ApplicationParseResult {
  const records = parseCsvRecords(csvText);
  const anomalies: ApplicationAnomaly[] = [];
  const applications: ParsedApplication[] = [];

  if (records.length === 0) {
    return { seasonYear: null, applications: [], anomalies: [] };
  }

  const headerRow = records[0];
  const map = buildColumnMap(headerRow);
  const seasonYear = extractSeasonYear(headerRow, map);

  for (let rowIndex = 0; rowIndex < records.length - 1; rowIndex++) {
    const row = records[rowIndex + 1];
    // Skip fully-blank trailing rows.
    if (row.every((c) => (c ?? "").trim() === "")) continue;

    const firstName = getCell(row, map.firstName);
    const lastName = getCell(row, map.lastName);
    const name = `${firstName} ${lastName}`.trim();

    const submittedAtRaw = getCell(row, map.timestamp);
    const submittedAt = parseTimestamp(submittedAtRaw);
    if (submittedAtRaw !== "" && submittedAt === null) {
      anomalies.push({ rowIndex, name, field: "submittedAt", detail: "unparseable timestamp", raw: submittedAtRaw });
    }

    const dobRaw = getCell(row, map.dob);
    const dob = parseDob(dobRaw, rowIndex, name, seasonYear, anomalies);

    const gradYearRaw = getCell(row, map.gradYear);
    const gradYear = parseGradYear(gradYearRaw, rowIndex, name, anomalies);

    const interestsRaw = getCell(row, map.interests);
    const interests = interestsRaw === "" ? [] : interestsRaw.split(",").map((s) => s.trim()).filter((s) => s !== "");

    const experiences: ParsedExperience[] = [
      ...parseExperienceCell(getCell(row, map.fllExplore), "fll_explore", rowIndex, name, anomalies),
      ...parseExperienceCell(getCell(row, map.fllChallenge), "fll_challenge", rowIndex, name, anomalies),
      ...parseExperienceCell(getCell(row, map.ftc), "ftc", rowIndex, name, anomalies),
      ...parseExperienceCell(getCell(row, map.frc), "frc", rowIndex, name, anomalies),
    ];

    const guardians: ParsedGuardian[] = [];
    const g1 = buildGuardian(
      getCell(row, map.g1FirstName),
      getCell(row, map.g1LastName),
      getCell(row, map.g1Relationship),
      getCell(row, map.g1Phone),
      getCell(row, map.g1Email),
      getCell(row, map.g1Employer),
    );
    if (g1) guardians.push(g1);
    const g2 = buildGuardian(
      getCell(row, map.g2FirstName),
      getCell(row, map.g2LastName),
      getCell(row, map.g2Relationship),
      getCell(row, map.g2Phone),
      getCell(row, map.g2Email),
      getCell(row, map.g2Employer),
    );
    if (g2) guardians.push(g2);

    const application: ParsedApplication = {
      firstName,
      lastName,
      preferredName: nullIfEmptyOrNA(getCell(row, map.preferredName)),
      email: normalizeEmail(getCell(row, map.email)),
      gradYear,
      dob,
      school: nullIfEmptyOrNA(getCell(row, map.school)),
      streetAddress: nullIfEmptyOrNA(getCell(row, map.streetAddress)),
      city: nullIfEmptyOrNA(getCell(row, map.city)),
      zip: nullIfEmptyOrNA(getCell(row, map.zip)),
      homePhone: normalizePhone(getCell(row, map.homePhone)),
      phone: normalizePhone(getCell(row, map.phone)),
      shirtSize: nullIfEmptyOrNA(getCell(row, map.shirtSize)),
      ethnicity: nullIfEmptyOrNA(getCell(row, map.ethnicity)),
      race: nullIfEmptyOrNA(getCell(row, map.race)),
      dietaryRestrictions: nullIfEmptyOrNA(getCell(row, map.dietaryRestrictions)),
      interests,
      guardians,
      experiences,
      submittedAt,
    };

    applications.push(application);
  }

  const deduped = dedupeApplications(applications);

  return { seasonYear, applications: deduped, anomalies };
}

function dedupeApplications(applications: ParsedApplication[]): ParsedApplication[] {
  const byKey = new Map<string, { app: ParsedApplication; index: number }>();
  const order: string[] = [];

  applications.forEach((app, index) => {
    const key = `${nameKey(app.firstName, app.lastName)}|${app.dob ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { app, index });
      order.push(key);
      return;
    }
    const existingTime = existing.app.submittedAt ? Date.parse(existing.app.submittedAt) : NaN;
    const candidateTime = app.submittedAt ? Date.parse(app.submittedAt) : NaN;
    if (!Number.isNaN(candidateTime) && (Number.isNaN(existingTime) || candidateTime >= existingTime)) {
      byKey.set(key, { app, index: existing.index });
    }
    // If candidate timestamp is unparseable, preserve first-seen (do nothing).
  });

  return order.map((key) => byKey.get(key)!.app);
}
