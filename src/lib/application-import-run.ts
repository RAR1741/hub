import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApplications, nameKey, type ParsedApplication, type ParsedGuardian } from "./application-parse";

export type ApplicationDecision = "create" | "skip" | `link:${string}`;

export type ApplicationImportSummary = {
  dryRun: boolean;
  created: string[]; // names that would be / were created
  matched: { name: string; personId: string; changes: { field: string; from: unknown; to: unknown }[] }[];
  needsDecision: { key: string; applicant: string; candidates: { personId: string; name: string; reason: string }[] }[];
  stale: { name: string }[]; // skipped: person.last_application_at >= this response
  skipped: { name: string; reason: string }[]; // decision=skip
  guardiansCreated: number;
  guardiansMatched: number;
  experienceRows: number;
  roleCallouts: { name: string; role: string }[]; // matched person is mentor/admin (never role-changed)
  anomalies: { name: string; field: string; detail: string }[];
  errors: { name: string; message: string }[];
  wouldDeactivate: number; // dry-run projection
  deactivated: number; // 0 on dry-run
};

const normalizeFull = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const normalizeEmail = (e: string | null) => (e ? e.trim().toLowerCase() : null);
const digitsOnly = (p: string | null) => (p ? p.replace(/[^0-9]/g, "") : null);

/** Decision key: first|last|dob, lowercased — mirrors the time importer's anomalyKey. */
function decisionKey(first: string, last: string, dob: string | null): string {
  return `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${dob ?? ""}`;
}

type RosterPerson = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  role: "admin" | "mentor" | "student";
  grad_year: number | null;
  email: string | null;
  last_application_at: string | null;
  date_of_birth: string | null;
  school: string | null;
  street_address: string | null;
  city: string | null;
  zip: string | null;
  home_phone: string | null;
  phone: string | null;
  shirt_size: string | null;
  ethnicity: string | null;
  race: string | null;
  interests: string[] | null;
  dietary_restrictions: string | null;
};

type RosterGuardian = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  last_application_at: string | null;
};

type Candidate = { personId: string; name: string; reason: string };

type Outcome =
  | { kind: "auto-match"; personId: string }
  | { kind: "needs-decision"; key: string; candidates: Candidate[] }
  | { kind: "create" };

export async function runApplicationImport(args: {
  csvText: string;
  dryRun: boolean;
  decisions?: Record<string, ApplicationDecision>;
  confirm?: boolean;
  now?: () => Date;
  db?: SupabaseClient;
}): Promise<ApplicationImportSummary | { error: string }> {
  const db = args.db ?? (await import("./db")).getDb();
  const dryRun = args.dryRun;
  const decisions = args.decisions ?? {};
  const now = args.now ?? (() => new Date());
  const confirm = args.confirm ?? false;

  const parsed = parseApplications(args.csvText);
  if (parsed.applications.length === 0) {
    return { error: "no_data" };
  }

  const { data: peopleRows, error: rosterError } = await db
    .from("person")
    .select(
      "id, first_name, last_name, display_name, role, grad_year, email, last_application_at, date_of_birth, school, street_address, city, zip, home_phone, phone, shirt_size, ethnicity, race, interests, dietary_restrictions",
    );
  if (rosterError) return { error: `roster_load_failed: ${rosterError.message}` };
  const roster = (peopleRows ?? []) as RosterPerson[];

  const { data: guardianRows, error: guardianError } = await db
    .from("guardian")
    .select("id, first_name, last_name, email, phone, employer, last_application_at");
  if (guardianError) return { error: `guardian_load_failed: ${guardianError.message}` };
  const guardianRoster = (guardianRows ?? []) as RosterGuardian[];

  // Indexes for exact + fuzzy matching.
  const byNameKey = new Map<string, string[]>();
  const byPreferredKey = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  const byLastName = new Map<string, RosterPerson[]>();
  const personById = new Map<string, RosterPerson>();
  const pushId = (m: Map<string, string[]>, k: string, id: string) => {
    if (k) m.set(k, [...(m.get(k) ?? []), id]);
  };
  for (const p of roster) {
    personById.set(p.id, p);
    pushId(byNameKey, nameKey(p.first_name, p.last_name), p.id);
    if (p.display_name) pushId(byPreferredKey, normalizeFull(p.display_name), p.id);
    const em = normalizeEmail(p.email);
    if (em) pushId(byEmail, em, p.id);
    const lastKey = p.last_name.trim().toLowerCase();
    byLastName.set(lastKey, [...(byLastName.get(lastKey) ?? []), p]);
  }

  const guardianByNameKey = new Map<string, RosterGuardian[]>();
  for (const g of guardianRoster) {
    const k = nameKey(g.first_name, g.last_name);
    guardianByNameKey.set(k, [...(guardianByNameKey.get(k) ?? []), g]);
  }

  const isPrefixMatch = (a: string, b: string): boolean => {
    const na = a.trim().toLowerCase();
    const nb = b.trim().toLowerCase();
    if (na === "" || nb === "") return false;
    return na.startsWith(nb) || nb.startsWith(na);
  };

  function matchApplicant(app: ParsedApplication): Outcome {
    const nkey = nameKey(app.firstName, app.lastName);
    const dkey = normalizeFull(`${app.preferredName ?? app.firstName} ${app.lastName}`);
    const ekey = normalizeEmail(app.email);
    const exactIds = new Set<string>([
      ...(byNameKey.get(nkey) ?? []),
      ...(byPreferredKey.get(dkey) ?? []),
      ...(ekey ? byEmail.get(ekey) ?? [] : []),
    ]);
    if (exactIds.size === 1) {
      return { kind: "auto-match", personId: [...exactIds][0] };
    }
    const key = decisionKey(app.firstName, app.lastName, app.dob);
    if (exactIds.size > 1) {
      const candidates: Candidate[] = [...exactIds].map((id) => {
        const p = personById.get(id)!;
        return { personId: id, name: `${p.first_name} ${p.last_name}`, reason: "ambiguous exact match" };
      });
      return { kind: "needs-decision", key, candidates };
    }

    // Fuzzy: same normalized last name AND (first-name prefix either
    // direction OR preferred == person first/display name).
    const lastKey = app.lastName.trim().toLowerCase();
    const sameLast = byLastName.get(lastKey) ?? [];
    const preferred = app.preferredName ?? app.firstName;
    const fuzzy = sameLast.filter((p) => {
      const prefixMatch = isPrefixMatch(app.firstName, p.first_name);
      const preferredMatch =
        normalizeFull(preferred) === normalizeFull(p.first_name) ||
        (p.display_name !== null && normalizeFull(preferred) === normalizeFull(p.display_name));
      return prefixMatch || preferredMatch;
    });
    if (fuzzy.length > 0) {
      const candidates: Candidate[] = fuzzy.map((p) => ({
        personId: p.id,
        name: `${p.first_name} ${p.last_name}`,
        reason: "fuzzy match (same last name)",
      }));
      return { kind: "needs-decision", key, candidates };
    }

    return { kind: "create" };
  }

  const summary: ApplicationImportSummary = {
    dryRun,
    created: [],
    matched: [],
    needsDecision: [],
    stale: [],
    skipped: [],
    guardiansCreated: 0,
    guardiansMatched: 0,
    experienceRows: 0,
    roleCallouts: [],
    anomalies: [],
    errors: [],
    wouldDeactivate: 0,
    deactivated: 0,
  };
  for (const a of parsed.anomalies) {
    summary.anomalies.push({ name: a.name, field: a.field, detail: a.detail });
  }

  // Phase 1: resolve every applicant to an outcome (no writes).
  type Resolved = {
    app: ParsedApplication;
    name: string;
    action: "matched" | "create" | "skip" | "stale" | "error";
    personId?: string;
  };
  const resolved: Resolved[] = [];

  for (const app of parsed.applications) {
    const name = `${app.firstName} ${app.lastName}`.trim();
    const outcome = matchApplicant(app);

    if (outcome.kind === "auto-match") {
      resolved.push({ app, name, action: "matched", personId: outcome.personId });
      continue;
    }

    if (outcome.kind === "create") {
      resolved.push({ app, name, action: "create" });
      continue;
    }

    // needs-decision: check for a decision entry.
    const decision = decisions[outcome.key];
    if (decision === undefined) {
      summary.needsDecision.push({ key: outcome.key, applicant: name, candidates: outcome.candidates });
      // On dry-run we still project it; on confirm the undecided check below blocks writes.
      resolved.push({ app, name, action: "error" });
      continue;
    }
    if (decision === "create") {
      resolved.push({ app, name, action: "create" });
    } else if (decision === "skip") {
      summary.skipped.push({ name, reason: "decision=skip" });
      resolved.push({ app, name, action: "skip" });
    } else if (decision.startsWith("link:")) {
      const personId = decision.slice("link:".length);
      resolved.push({ app, name, action: "matched", personId });
    } else {
      resolved.push({ app, name, action: "error" });
    }
  }

  // Undecided check BEFORE any write.
  if (confirm && summary.needsDecision.length > 0) {
    return { error: "undecided_decisions" };
  }

  if (dryRun) {
    // Project matched/created/stale without writing, using season-year math for wouldDeactivate.
    const seasonYear = currentSeasonYear(now());
    const dryCreatedGradYears: number[] = [];
    for (const r of resolved) {
      if (r.action === "matched" && r.personId) {
        const person = personById.get(r.personId);
        const staleCheck = isStale(person?.last_application_at ?? null, r.app.submittedAt);
        if (staleCheck) {
          summary.stale.push({ name: r.name });
          continue;
        }
        if (person && (person.role === "mentor" || person.role === "admin")) {
          summary.roleCallouts.push({ name: r.name, role: person.role });
        }
        const changes = person ? computeChanges(person, r.app) : [];
        summary.matched.push({ name: r.name, personId: r.personId, changes });
      } else if (r.action === "create") {
        summary.created.push(r.name);
        if (r.app.gradYear !== null) dryCreatedGradYears.push(r.app.gradYear);
      }
    }
    const rosterStudentGradYears = roster.filter((p) => p.role === "student").map((p) => p.grad_year);
    const allGradYears = [...rosterStudentGradYears, ...dryCreatedGradYears];
    summary.wouldDeactivate = allGradYears.filter((y) => y !== null && y < seasonYear).length;
    summary.deactivated = 0;
    // Guardian projection (best-effort counts only; no writes).
    for (const r of resolved) {
      if (r.action === "matched" || r.action === "create") {
        for (const g of r.app.guardians) {
          const match = findGuardianMatch(g, guardianByNameKey);
          if (match) summary.guardiansMatched += 1;
          else summary.guardiansCreated += 1;
        }
        summary.experienceRows += r.app.experiences.length;
      }
    }
    return summary;
  }

  // Phase 2: real writes.
  const writtenPersonIds = new Set<string>();

  for (const r of resolved) {
    if (r.action === "skip" || r.action === "error") continue;

    if (r.action === "create") {
      const isActive = computeIsActive(r.app.gradYear, now());
      const { data, error } = await db
        .from("person")
        .insert({
          first_name: r.app.firstName,
          last_name: r.app.lastName,
          display_name: displayNameFor(r.app),
          role: "student",
          grad_year: r.app.gradYear,
          email: r.app.email,
          is_active: isActive,
          date_of_birth: r.app.dob,
          street_address: r.app.streetAddress,
          city: r.app.city,
          zip: r.app.zip,
          home_phone: r.app.homePhone,
          phone: r.app.phone,
          school: r.app.school,
          shirt_size: r.app.shirtSize,
          ethnicity: r.app.ethnicity,
          race: r.app.race,
          interests: r.app.interests,
          ...(r.app.dietaryRestrictions ? { dietary_restrictions: r.app.dietaryRestrictions } : {}),
          last_application_at: r.app.submittedAt,
        })
        .select("id")
        .single();
      if (error || !data) {
        summary.errors.push({ name: r.name, message: `Failed to create person: ${error?.message ?? "unknown"}` });
        continue;
      }
      const personId = data.id as string;
      summary.created.push(r.name);
      writtenPersonIds.add(personId);
      await writeExperiences(db, personId, r.app, summary);
      await writeGuardians(db, personId, r.app, guardianByNameKey, guardianRoster, now(), summary);
      continue;
    }

    if (r.action === "matched" && r.personId) {
      const person = personById.get(r.personId);
      const stale = isStale(person?.last_application_at ?? null, r.app.submittedAt);
      if (stale) {
        summary.stale.push({ name: r.name });
        continue;
      }
      if (person && (person.role === "mentor" || person.role === "admin")) {
        summary.roleCallouts.push({ name: r.name, role: person.role });
      }
      const patch: Record<string, unknown> = {
        display_name: displayNameFor(r.app),
        date_of_birth: r.app.dob,
        grad_year: r.app.gradYear,
        school: r.app.school,
        street_address: r.app.streetAddress,
        city: r.app.city,
        zip: r.app.zip,
        home_phone: r.app.homePhone,
        phone: r.app.phone,
        email: r.app.email,
        shirt_size: r.app.shirtSize,
        ethnicity: r.app.ethnicity,
        race: r.app.race,
        interests: r.app.interests,
        last_application_at: r.app.submittedAt,
      };
      if (r.app.dietaryRestrictions) patch.dietary_restrictions = r.app.dietaryRestrictions;

      const changes = person ? computeChanges(person, r.app) : [];
      const { error } = await db.from("person").update(patch).eq("id", r.personId);
      if (error) {
        summary.errors.push({ name: r.name, message: `Failed to update person: ${error.message}` });
        continue;
      }
      summary.matched.push({ name: r.name, personId: r.personId, changes });
      writtenPersonIds.add(r.personId);
      await writeExperiences(db, r.personId, r.app, summary);
      await writeGuardians(db, r.personId, r.app, guardianByNameKey, guardianRoster, now(), summary);
    }
  }

  // Deactivation sweep.
  const seasonYear = currentSeasonYear(now());
  const deactivateRes = await db
    .from("person")
    .update({ is_active: false })
    .eq("role", "student")
    .lt("grad_year", seasonYear)
    .select("id");
  if (deactivateRes.error) summary.errors.push({ name: "deactivation", message: deactivateRes.error.message });

  let deactivatedCount = (deactivateRes.data as { id: string }[] | null)?.length ?? 0;
  if (writtenPersonIds.size > 0) {
    const activateRes = await db
      .from("person")
      .update({ is_active: true })
      .gte("grad_year", seasonYear)
      .in("id", [...writtenPersonIds])
      .select("id");
    if (activateRes.error) summary.errors.push({ name: "activation", message: activateRes.error.message });
  }
  summary.deactivated = deactivatedCount;

  return summary;
}

function currentSeasonYear(now: Date): number {
  return now.getMonth() >= 5 ? now.getFullYear() + 1 : now.getFullYear();
}

function computeIsActive(gradYear: number | null, now: Date): boolean {
  if (gradYear === null) return true;
  return gradYear >= currentSeasonYear(now);
}

function isStale(personLastApplicationAt: string | null, submittedAt: string | null): boolean {
  if (personLastApplicationAt === null) return false;
  if (submittedAt === null) return true; // can't prove newer — treat as stale.
  return Date.parse(personLastApplicationAt) >= Date.parse(submittedAt);
}

function displayNameFor(app: ParsedApplication): string | null {
  if (app.preferredName && normalizeFull(app.preferredName) !== normalizeFull(app.firstName)) {
    return app.preferredName;
  }
  return null;
}

function computeChanges(
  person: RosterPerson,
  app: ParsedApplication,
): { field: string; from: unknown; to: unknown }[] {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const check = (field: string, from: unknown, to: unknown) => {
    if (from !== to) changes.push({ field, from, to });
  };
  check("display_name", person.display_name, displayNameFor(app));
  check("date_of_birth", person.date_of_birth, app.dob);
  check("grad_year", person.grad_year, app.gradYear);
  check("school", person.school, app.school);
  check("street_address", person.street_address, app.streetAddress);
  check("city", person.city, app.city);
  check("zip", person.zip, app.zip);
  check("home_phone", person.home_phone, app.homePhone);
  check("phone", person.phone, app.phone);
  check("email", person.email, app.email);
  check("shirt_size", person.shirt_size, app.shirtSize);
  check("ethnicity", person.ethnicity, app.ethnicity);
  check("race", person.race, app.race);
  if (JSON.stringify(person.interests ?? []) !== JSON.stringify(app.interests)) {
    changes.push({ field: "interests", from: person.interests, to: app.interests });
  }
  if (app.dietaryRestrictions) check("dietary_restrictions", person.dietary_restrictions, app.dietaryRestrictions);
  return changes;
}

function findGuardianMatch(
  g: ParsedGuardian,
  guardianByNameKey: Map<string, RosterGuardian[]>,
): RosterGuardian | null {
  const key = nameKey(g.firstName, g.lastName);
  const candidates = guardianByNameKey.get(key) ?? [];
  if (candidates.length === 0) return null;
  const gEmail = normalizeEmail(g.email);
  const gPhone = digitsOnly(g.phone);
  if (gEmail === null && gPhone === null) {
    // No contact info to disambiguate — allow name-only match (avoids
    // duplicate guardian rows for contactless sibling forms).
    return candidates[0];
  }
  for (const c of candidates) {
    const cEmail = normalizeEmail(c.email);
    const cPhone = digitsOnly(c.phone);
    if ((gEmail !== null && gEmail === cEmail) || (gPhone !== null && gPhone === cPhone)) {
      return c;
    }
  }
  return null;
}

async function writeExperiences(
  db: SupabaseClient,
  personId: string,
  app: ParsedApplication,
  summary: ApplicationImportSummary,
): Promise<void> {
  const delRes = await db.from("first_experience").delete().eq("person_id", personId);
  if (delRes.error) {
    summary.errors.push({ name: personId, message: `Failed to clear experiences: ${delRes.error.message}` });
    return;
  }
  if (app.experiences.length === 0) return;
  const rows = app.experiences.map((e) => ({ person_id: personId, level: e.level, year: e.year, name: e.name }));
  const insRes = await db.from("first_experience").insert(rows);
  if (insRes.error) {
    summary.errors.push({ name: personId, message: `Failed to insert experiences: ${insRes.error.message}` });
    return;
  }
  summary.experienceRows += rows.length;
}

async function writeGuardians(
  db: SupabaseClient,
  personId: string,
  app: ParsedApplication,
  guardianByNameKey: Map<string, RosterGuardian[]>,
  guardianRoster: RosterGuardian[],
  now: Date,
  summary: ApplicationImportSummary,
): Promise<void> {
  for (const g of app.guardians) {
    let guardianId: string;
    const match = findGuardianMatch(g, guardianByNameKey);
    if (match) {
      guardianId = match.id;
      summary.guardiansMatched += 1;
      const newer =
        match.last_application_at === null ||
        (app.submittedAt !== null && Date.parse(app.submittedAt) > Date.parse(match.last_application_at));
      if (newer) {
        const { error } = await db
          .from("guardian")
          .update({
            email: g.email,
            phone: g.phone,
            employer: g.employer,
            last_application_at: app.submittedAt,
          })
          .eq("id", guardianId);
        if (error) summary.errors.push({ name: personId, message: `Failed to update guardian: ${error.message}` });
      }
    } else {
      const { data, error } = await db
        .from("guardian")
        .insert({
          first_name: g.firstName,
          last_name: g.lastName,
          email: g.email,
          phone: g.phone,
          employer: g.employer,
          last_application_at: app.submittedAt,
        })
        .select("id")
        .single();
      if (error || !data) {
        summary.errors.push({ name: personId, message: `Failed to create guardian: ${error?.message ?? "unknown"}` });
        continue;
      }
      guardianId = data.id as string;
      summary.guardiansCreated += 1;
      const key = nameKey(g.firstName, g.lastName);
      const newGuardian: RosterGuardian = {
        id: guardianId,
        first_name: g.firstName,
        last_name: g.lastName,
        email: g.email,
        phone: g.phone,
        employer: g.employer,
        last_application_at: app.submittedAt,
      };
      guardianByNameKey.set(key, [...(guardianByNameKey.get(key) ?? []), newGuardian]);
      guardianRoster.push(newGuardian);
    }

    const { error: linkError } = await db
      .from("person_guardian")
      .upsert({ person_id: personId, guardian_id: guardianId, relationship: g.relationship }, { onConflict: "person_id,guardian_id" });
    if (linkError) summary.errors.push({ name: personId, message: `Failed to link guardian: ${linkError.message}` });
  }
}
