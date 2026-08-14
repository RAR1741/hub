import type { SupabaseClient } from "@supabase/supabase-js";
import { anomalyKey, nextDay, parseTimeSheet, type ParsedPerson } from "./time-import";

// accept/reject for ordinary anomalies; am/pm additionally pick the reading of
// an AM/PM-ambiguous clock-in. reject skips the session either way.
export type AnomalyDecision = "accept" | "reject" | "am" | "pm";
import { localDateTimeToInstant } from "./tz";
import { getPeriod } from "./periods";
import { getSetting } from "./settings";

export type RoleChange = { name: string; from: string; to: string };
export type TimeImportSummary = {
  dryRun: boolean;
  createdPeople: number;
  createdStudents: number;
  createdMentors: number;
  matchedPeople: number;
  roleChanges: RoleChange[];
  roleChangesApplied: boolean;
  sessions: number;
  excusals: number;
  skipped: { name: string; date: string; reason: string }[];
  anomalies: { name: string; date: string; kind: string; detail: string }[];
  errors: { name: string; message: string }[];
  createdNames: string[];
};

const nameKey = (first: string, last: string) => `${first.trim().toLowerCase()}\x00${last.trim().toLowerCase()}`;
const normalizeFull = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export async function runTimeImport(args: {
  csv: string;
  periodId: string;
  importedBy: string;
  db?: SupabaseClient;
  tz?: string;
  dryRun?: boolean;
  applyRoleChanges?: boolean;
  decisions?: Record<string, AnomalyDecision>;
}): Promise<TimeImportSummary | { error: string }> {
  const db = args.db ?? (await import("./db")).getDb();
  const dryRun = args.dryRun ?? false;
  const decisions = args.decisions ?? {};
  const period = await getPeriod(args.periodId, db);
  if (!period) return { error: "period_not_found" };
  const tz = args.tz ?? (await getSetting<string>("team_timezone", "America/Indiana/Indianapolis", db));

  const parsed = parseTimeSheet(args.csv);
  if (parsed.people.length === 0) return { error: parsed.fileIssues[0] ?? "no_data" };

  // Every flagged session must have an accept/reject decision before a real
  // import. Enforce BEFORE any write (person inserts, delete-then-insert) so a
  // rejected 400 never mutates the period. Dry-run is where deciding happens.
  if (!dryRun) {
    const undecided = parsed.people.some((p) =>
      p.anomalies.some((a) => decisions[anomalyKey(p.firstName, p.lastName, a.date)] === undefined),
    );
    if (undecided) return { error: "undecided_anomalies" };
  }

  // Load roster once; build name/display-name -> id[] index and id -> role.
  const { data: peopleRows, error: rosterError } = await db.from("person").select("id, first_name, last_name, display_name, role");
  if (rosterError) return { error: `roster_load_failed: ${rosterError.message}` };
  const byName = new Map<string, string[]>();
  const byDisplay = new Map<string, string[]>();
  const roleById = new Map<string, string>();
  const pushId = (m: Map<string, string[]>, k: string, id: string) => { if (k) m.set(k, [...(m.get(k) ?? []), id]); };
  for (const p of (peopleRows ?? []) as { id: string; first_name: string; last_name: string; display_name: string | null; role: string }[]) {
    pushId(byName, nameKey(p.first_name, p.last_name), p.id);
    if (p.display_name) pushId(byDisplay, normalizeFull(p.display_name), p.id);
    roleById.set(p.id, p.role);
  }

  const summary: TimeImportSummary = {
    dryRun, createdPeople: 0, createdStudents: 0, createdMentors: 0, matchedPeople: 0,
    roleChanges: [], roleChangesApplied: false, sessions: 0, excusals: 0,
    skipped: [], anomalies: [], errors: [], createdNames: [],
  };
  const sessionRows: Record<string, unknown>[] = [];
  const excusalRows: Record<string, unknown>[] = [];
  const roleUpdates: { id: string; role: "student" | "mentor"; name: string }[] = [];

  for (const person of parsed.people) {
    const name = `${person.firstName} ${person.lastName}`;
    const nkey = nameKey(person.firstName, person.lastName);
    const dkey = normalizeFull(name);
    const candidateIds = new Set<string>([...(byName.get(nkey) ?? []), ...(byDisplay.get(dkey) ?? [])]);

    let personId: string;
    if (candidateIds.size > 1) {
      summary.errors.push({ name, message: "Ambiguous — name matches more than one person" });
      continue;
    } else if (candidateIds.size === 1) {
      personId = [...candidateIds][0];
      summary.matchedPeople += 1;
      // Role change only when the sheet's group disagrees with an existing
      // student/mentor role. Admins/guests are never reassigned by position.
      const currentRole = roleById.get(personId);
      if ((currentRole === "student" || currentRole === "mentor") && currentRole !== person.roleHint) {
        summary.roleChanges.push({ name, from: currentRole, to: person.roleHint });
        roleUpdates.push({ id: personId, role: person.roleHint, name });
      }
    } else if (dryRun) {
      // Would-create. Use a placeholder id so a repeated new name dedupes.
      personId = `dry-${summary.createdPeople}`;
      pushId(byName, nkey, personId);
      summary.createdPeople += 1;
      if (person.roleHint === "mentor") summary.createdMentors += 1; else summary.createdStudents += 1;
      summary.createdNames.push(name);
    } else {
      const { data, error } = await db.from("person")
        .insert({ first_name: person.firstName, last_name: person.lastName, role: person.roleHint, is_active: true })
        .select("id").single();
      if (error || !data) { summary.errors.push({ name, message: "Failed to create person" }); continue; }
      personId = data.id as string;
      pushId(byName, nkey, personId);
      summary.createdPeople += 1;
      if (person.roleHint === "mentor") summary.createdMentors += 1; else summary.createdStudents += 1;
      summary.createdNames.push(name);
    }

    collectRows(person, personId, name, args.periodId, tz, args.importedBy, sessionRows, excusalRows, summary, decisions);
  }

  if (dryRun) return summary; // preview only — never writes.

  // Apply role changes only when the admin explicitly opted in after the callout.
  if ((args.applyRoleChanges ?? false) && roleUpdates.length > 0) {
    for (const u of roleUpdates) {
      const { error } = await db.from("person").update({ role: u.role }).eq("id", u.id);
      if (error) summary.errors.push({ name: u.name, message: `Failed to update role: ${error.message}` });
    }
    summary.roleChangesApplied = true;
  }

  // Idempotent replace: clear this period's prior import rows, then insert.
  const delSession = await db.from("session").delete().eq("period_id", args.periodId).eq("source", "import");
  if (delSession.error) return { error: `session_delete_failed: ${delSession.error.message}` };
  const delExcusal = await db.from("excusal").delete().eq("source", "import").gte("date", period.startsOn).lte("date", period.endsOn);
  if (delExcusal.error) return { error: `excusal_delete_failed: ${delExcusal.error.message}` };

  for (let i = 0; i < sessionRows.length; i += 500) {
    const { error } = await db.from("session").insert(sessionRows.slice(i, i + 500));
    if (error) return { error: `session_insert_failed: ${error.message}` };
  }
  if (excusalRows.length > 0) {
    const { error } = await db.from("excusal").upsert(excusalRows, { onConflict: "person_id,date", ignoreDuplicates: true });
    if (error) return { error: `excusal_insert_failed: ${error.message}` };
  }

  return summary;
}

function collectRows(
  person: ParsedPerson, personId: string, name: string, periodId: string, tz: string, importedBy: string,
  sessionRows: Record<string, unknown>[], excusalRows: Record<string, unknown>[], summary: TimeImportSummary,
  decisions: Record<string, AnomalyDecision>,
) {
  for (const s of person.sessions) {
    const decision = decisions[anomalyKey(person.firstName, person.lastName, s.date)];
    // A flagged session the admin rejected in preview is skipped, not imported.
    if (decision === "reject") {
      summary.skipped.push({ name, date: s.date, reason: "rejected in preview" });
      continue;
    }
    // An AM/PM decision overrides the ambiguous clock-in; recompute whether the
    // (fixed) clock-out now rolls past midnight relative to the chosen in-time.
    let timeIn = s.timeIn;
    let timeOutDate = s.timeOutDate;
    if (s.amPm && (decision === "am" || decision === "pm")) {
      timeIn = decision === "am" ? s.amPm.am : s.amPm.pm;
      timeOutDate = toMinutes(s.timeOut) < toMinutes(timeIn) ? nextDay(s.date) : s.date;
    }
    sessionRows.push({
      person_id: personId,
      period_id: periodId,
      time_in: localDateTimeToInstant(s.date, toMinutes(timeIn), tz),
      time_out: localDateTimeToInstant(timeOutDate, toMinutes(s.timeOut), tz),
      source: "import",
    });
    summary.sessions += 1;
  }
  for (const e of person.excusals) {
    excusalRows.push({ person_id: personId, date: e.date, source: "import", created_by: importedBy });
    summary.excusals += 1;
  }
  for (const sk of person.skipped) summary.skipped.push({ name, date: sk.date, reason: sk.reason });
  for (const a of person.anomalies) summary.anomalies.push({ name, date: a.date, kind: a.kind, detail: a.detail });
}
