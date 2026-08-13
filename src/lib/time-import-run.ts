import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTimeSheet, type ParsedPerson } from "./time-import";
import { localDateTimeToInstant } from "./tz";
import { getPeriod } from "./periods";
import { getSetting } from "./settings";

export type TimeImportSummary = {
  createdPeople: number;
  matchedPeople: number;
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
}): Promise<TimeImportSummary | { error: string }> {
  const db = args.db ?? (await import("./db")).getDb();
  const period = await getPeriod(args.periodId, db);
  if (!period) return { error: "period_not_found" };
  const tz = args.tz ?? (await getSetting<string>("team_timezone", "America/Indiana/Indianapolis", db));

  const parsed = parseTimeSheet(args.csv);
  if (parsed.people.length === 0) return { error: parsed.fileIssues[0] ?? "no_data" };

  // Load roster once; build name/display-name -> id[] index.
  const { data: peopleRows, error: rosterError } = await db.from("person").select("id, first_name, last_name, display_name");
  if (rosterError) return { error: `roster_load_failed: ${rosterError.message}` };
  const byName = new Map<string, string[]>();
  const byDisplay = new Map<string, string[]>();
  const pushId = (m: Map<string, string[]>, k: string, id: string) => { if (k) m.set(k, [...(m.get(k) ?? []), id]); };
  for (const p of (peopleRows ?? []) as { id: string; first_name: string; last_name: string; display_name: string | null }[]) {
    pushId(byName, nameKey(p.first_name, p.last_name), p.id);
    if (p.display_name) pushId(byDisplay, normalizeFull(p.display_name), p.id);
  }

  const summary: TimeImportSummary = {
    createdPeople: 0, matchedPeople: 0, sessions: 0, excusals: 0,
    skipped: [], anomalies: [], errors: [], createdNames: [],
  };
  const sessionRows: Record<string, unknown>[] = [];
  const excusalRows: Record<string, unknown>[] = [];

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
    } else {
      const { data, error } = await db.from("person")
        .insert({ first_name: person.firstName, last_name: person.lastName, role: "student", is_active: true })
        .select("id").single();
      if (error || !data) { summary.errors.push({ name, message: "Failed to create person" }); continue; }
      personId = data.id as string;
      pushId(byName, nkey, personId);
      summary.createdPeople += 1;
      summary.createdNames.push(name);
    }

    collectRows(person, personId, name, args.periodId, tz, args.importedBy, sessionRows, excusalRows, summary);
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
) {
  for (const s of person.sessions) {
    sessionRows.push({
      person_id: personId,
      period_id: periodId,
      time_in: localDateTimeToInstant(s.date, toMinutes(s.timeIn), tz),
      time_out: localDateTimeToInstant(s.timeOutDate, toMinutes(s.timeOut), tz),
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
