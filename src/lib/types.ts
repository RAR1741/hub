export type Role = "admin" | "mentor" | "student" | "guest";

/** Row shape of the person table (snake_case, as returned by supabase-js). */
export type PersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  role: "admin" | "mentor" | "student";
  grad_year: number | null;
  email: string | null;
  is_active: boolean;
  student_id_number: string | null;
  phone?: string | null;
  shirt_size?: string | null;
  dietary_restrictions?: string | null;
  bio?: string | null;
  date_of_birth?: string | null;
  street_address?: string | null;
  city?: string | null;
  zip?: string | null;
  home_phone?: string | null;
  school?: string | null;
  ethnicity?: string | null;
  race?: string | null;
  interests?: string[] | null;
  last_application_at?: string | null;
  first_people_id?: number | null;
  first_consent_release?: boolean | null;
  first_screening_status?: string | null;
  first_screening_text?: string | null;
  first_training_status?: string | null;
  first_synced_at?: string | null;
  slack_user_id?: string | null;
};

export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: Exclude<Role, "guest">;
  gradYear: number | null;
  email: string | null;
  isActive: boolean;
  studentIdNumber: string | null;
  phone: string | null;
  shirtSize: string | null;
  dietaryRestrictions: string | null;
  bio: string | null;
  dateOfBirth: string | null;
  streetAddress: string | null;
  city: string | null;
  zip: string | null;
  homePhone: string | null;
  school: string | null;
  ethnicity: string | null;
  race: string | null;
  interests: string[] | null;
  lastApplicationAt: string | null;
  firstPeopleId: number | null;
  firstConsentRelease: boolean | null;
  firstScreeningStatus: string | null;
  firstScreeningText: string | null;
  firstTrainingStatus: string | null;
  firstSyncedAt: string | null;
  slackUserId?: string | null;
};

export function personFromRow(row: PersonRow): Person {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    role: row.role,
    gradYear: row.grad_year,
    email: row.email,
    isActive: row.is_active,
    studentIdNumber: row.student_id_number,
    phone: row.phone ?? null,
    shirtSize: row.shirt_size ?? null,
    dietaryRestrictions: row.dietary_restrictions ?? null,
    bio: row.bio ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    streetAddress: row.street_address ?? null,
    city: row.city ?? null,
    zip: row.zip ?? null,
    homePhone: row.home_phone ?? null,
    school: row.school ?? null,
    ethnicity: row.ethnicity ?? null,
    race: row.race ?? null,
    interests: row.interests ?? null,
    lastApplicationAt: row.last_application_at ?? null,
    firstPeopleId: row.first_people_id ?? null,
    firstConsentRelease: row.first_consent_release ?? null,
    firstScreeningStatus: row.first_screening_status ?? null,
    firstScreeningText: row.first_screening_text ?? null,
    firstTrainingStatus: row.first_training_status ?? null,
    firstSyncedAt: row.first_synced_at ?? null,
    slackUserId: row.slack_user_id ?? null,
  };
}

export type JoinMode = "admin_only" | "open" | "requires_approval";

export type TeamRow = {
  id: string;
  name: string;
  parent_team_id: string | null;
  description: string | null;
  join_mode: JoinMode;
  google_group_email: string | null;
};

export type Team = {
  id: string;
  name: string;
  parentTeamId: string | null;
  description: string | null;
  joinMode: JoinMode;
  googleGroupEmail: string | null;
};

export function teamFromRow(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    parentTeamId: row.parent_team_id,
    description: row.description,
    joinMode: row.join_mode,
    googleGroupEmail: row.google_group_email,
  };
}

export type BadgeRow = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string;
  team_id: string | null;
  allow_self_award: boolean;
  created_by: string;
  created_at: string;
};

export type Badge = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string;
  teamId: string | null;
  allowSelfAward: boolean;
  createdBy: string;
  createdAt: string;
};

export function badgeFromRow(row: BadgeRow): Badge {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    color: row.color,
    teamId: row.team_id,
    allowSelfAward: row.allow_self_award,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export type BadgeAwardRow = {
  id: string;
  badge_id: string;
  person_id: string;
  awarded_by: string;
  note: string | null;
  awarded_at: string;
};

export type BadgeAward = {
  id: string;
  badgeId: string;
  personId: string;
  awardedBy: string;
  note: string | null;
  awardedAt: string;
};

export function badgeAwardFromRow(row: BadgeAwardRow): BadgeAward {
  return {
    id: row.id,
    badgeId: row.badge_id,
    personId: row.person_id,
    awardedBy: row.awarded_by,
    note: row.note,
    awardedAt: row.awarded_at,
  };
}

export type ApplicationStatus = "pending" | "approved" | "denied";

export type SessionSource = "kiosk" | "manual" | "admin" | "import" | "event";

export type PeriodRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
};

export type Period = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
};

export function periodFromRow(row: PeriodRow): Period {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    isActive: row.is_active,
  };
}

export type SessionRow = {
  id: string;
  person_id: string;
  period_id: string;
  time_in: string;
  time_out: string | null;
  source: SessionSource;
  note: string | null;
  excluded_from_totals: boolean;
  edited_by: string | null;
  edited_at: string | null;
  flags_resolved_at: string | null;
  event_id: string | null;
};

export type Session = {
  id: string;
  personId: string;
  periodId: string;
  timeIn: string;
  timeOut: string | null;
  source: SessionSource;
  note: string | null;
  excludedFromTotals: boolean;
  editedBy: string | null;
  editedAt: string | null;
  flagsResolvedAt: string | null;
  eventId: string | null;
};

export function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id,
    personId: row.person_id,
    periodId: row.period_id,
    timeIn: row.time_in,
    timeOut: row.time_out,
    source: row.source,
    note: row.note,
    excludedFromTotals: row.excluded_from_totals,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
    flagsResolvedAt: row.flags_resolved_at,
    eventId: row.event_id,
  };
}

export type EventRow = {
  id: string;
  period_id: string;
  name: string;
  location: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string;
  created_by: string;
  created_at: string;
  gcal_event_id: string | null;
  gcal_missing: boolean;
  form_id: string | null;
};

export type Event = {
  id: string;
  periodId: string;
  name: string;
  location: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  createdAt: string;
  gcalEventId: string | null;
  gcalMissing: boolean;
  formId: string | null;
};

export function eventFromRow(row: EventRow): Event {
  return {
    id: row.id,
    periodId: row.period_id,
    name: row.name,
    location: row.location,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    gcalEventId: row.gcal_event_id,
    gcalMissing: row.gcal_missing,
    formId: row.form_id ?? null,
  };
}

export type FormFieldType =
  | "single_select" | "multi_select" | "boolean" | "short_text" | "long_text" | "scale";

// Internal marker for system-created fields. Set programmatically (the
// attendance question is auto-added to every event-signup form); never
// mentor-facing. Only "attending" exists today.
export type SemanticKey = "attending";

export type FormRow = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  created_by: string;
  created_at: string;
};
export type Form = {
  id: string; title: string; description: string | null;
  kind: string; status: string; createdBy: string; createdAt: string;
};
export function formFromRow(r: FormRow): Form {
  return {
    id: r.id, title: r.title, description: r.description, kind: r.kind,
    status: r.status, createdBy: r.created_by, createdAt: r.created_at,
  };
}

export type FormFieldRow = {
  id: string; form_id: string; label: string; help_text: string | null;
  type: FormFieldType; required: boolean; position: number; semantic_key: SemanticKey | null;
};
export type FormField = {
  id: string; formId: string; label: string; helpText: string | null;
  type: FormFieldType; required: boolean; position: number; semanticKey: SemanticKey | null;
};
export function formFieldFromRow(r: FormFieldRow): FormField {
  return {
    id: r.id, formId: r.form_id, label: r.label, helpText: r.help_text,
    type: r.type, required: r.required, position: r.position, semanticKey: r.semantic_key,
  };
}

export type FormFieldOptionRow = { id: string; field_id: string; value: string; label: string; position: number };
export type FormFieldOption = { id: string; fieldId: string; value: string; label: string; position: number };
export function formFieldOptionFromRow(r: FormFieldOptionRow): FormFieldOption {
  return { id: r.id, fieldId: r.field_id, value: r.value, label: r.label, position: r.position };
}

export type FormResponseRow = {
  id: string; form_id: string; person_id: string; event_id: string | null; submitted_at: string;
};
export type FormResponse = {
  id: string; formId: string; personId: string; eventId: string | null; submittedAt: string;
};
export function formResponseFromRow(r: FormResponseRow): FormResponse {
  return { id: r.id, formId: r.form_id, personId: r.person_id, eventId: r.event_id, submittedAt: r.submitted_at };
}

export type FormAnswerRow = { id: string; response_id: string; field_id: string; value: string | null };
export type FormAnswer = { id: string; responseId: string; fieldId: string; value: string | null };
export function formAnswerFromRow(r: FormAnswerRow): FormAnswer {
  return { id: r.id, responseId: r.response_id, fieldId: r.field_id, value: r.value };
}

export type BuildDayKind = "required" | "optional";
export type BuildDaySource = "gcal" | "manual";

export type MeetingRow = {
  id: string;
  gcal_event_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  synced_at: string;
};

export type Meeting = {
  id: string;
  gcalEventId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  syncedAt: string;
};

export function meetingFromRow(row: MeetingRow): Meeting {
  return {
    id: row.id,
    gcalEventId: row.gcal_event_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    syncedAt: row.synced_at,
  };
}

export type BuildDayRow = {
  date: string;
  kind: BuildDayKind;
  source: BuildDaySource;
  meeting_id: string | null;
};

export type BuildDay = {
  date: string;
  kind: BuildDayKind;
  source: BuildDaySource;
  meetingId: string | null;
};

export function buildDayFromRow(row: BuildDayRow): BuildDay {
  return {
    date: row.date,
    kind: row.kind,
    source: row.source,
    meetingId: row.meeting_id,
  };
}

export type ExcusalRow = {
  person_id: string;
  date: string;
  note: string | null;
  created_by: string | null;
};

export type Excusal = {
  personId: string;
  date: string;
  note: string | null;
  createdBy: string | null;
};

export function excusalFromRow(row: ExcusalRow): Excusal {
  return {
    personId: row.person_id,
    date: row.date,
    note: row.note,
    createdBy: row.created_by,
  };
}

export type ExcusalRequestStatus = "pending" | "approved" | "denied";

export type ExcusalRequestRow = {
  id: string;
  person_id: string;
  date: string;
  reason: string | null;
  status: ExcusalRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type ExcusalRequest = {
  id: string;
  personId: string;
  date: string;
  reason: string | null;
  status: ExcusalRequestStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export function excusalRequestFromRow(row: ExcusalRequestRow): ExcusalRequest {
  return {
    id: row.id,
    personId: row.person_id,
    date: row.date,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export type GuardianRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  last_application_at: string | null;
  updated_at: string;
};

export type Guardian = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  lastApplicationAt: string | null;
  updatedAt: string;
};

export function guardianFromRow(row: GuardianRow): Guardian {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    employer: row.employer,
    lastApplicationAt: row.last_application_at,
    updatedAt: row.updated_at,
  };
}

export type FirstExperienceLevel = "fll_explore" | "fll_challenge" | "ftc" | "frc";

export type FirstExperienceRow = {
  id: string;
  person_id: string;
  level: FirstExperienceLevel;
  year: number;
  name: string | null;
};

export type FirstExperience = {
  id: string;
  personId: string;
  level: FirstExperienceLevel;
  year: number;
  name: string | null;
};

export function firstExperienceFromRow(row: FirstExperienceRow): FirstExperience {
  return {
    id: row.id,
    personId: row.person_id,
    level: row.level,
    year: row.year,
    name: row.name,
  };
}

export type PartType = "part" | "assembly";
export type PartPriority = 0 | 1 | 2;

export const PART_STATUSES = [
  "designing", "material", "ordered", "drawing", "drawing_done", "mentor_approved", "ready",
  "cnc", "laser", "lathe", "mill", "printer", "router",
  "manufacturing", "outsourced", "welding", "scotchbrite",
  "anodize", "powder", "coating", "assembly", "done",
] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

/** Labels from cheesy-parts `models/part.rb` STATUS_MAP (commit 034ef59), plus two local additions: drawing_done, mentor_approved. */
export const STATUS_MAP: Record<PartStatus, string> = {
  designing: "Design in progress",
  material: "Material needs to be ordered",
  ordered: "Waiting for materials",
  drawing: "Needs drawing",
  drawing_done: "Drawing done",
  mentor_approved: "Mentor approved",
  ready: "Ready to manufacture",
  cnc: "Ready for CNC",
  laser: "Ready for laser",
  lathe: "Ready for lathe",
  mill: "Ready for mill",
  printer: "Ready for 3D printer",
  router: "Ready for router",
  manufacturing: "Manufacturing in progress",
  outsourced: "Waiting for outsourced manufacturing",
  welding: "Waiting for welding",
  scotchbrite: "Waiting for Scotch-Brite",
  anodize: "Ready for anodize",
  powder: "Ready for powder coating",
  coating: "Waiting for coating",
  assembly: "Waiting for assembly",
  done: "Done",
};

export type StatusTone = "design" | "blocked" | "ready" | "working" | "done";

export const STATUS_TONE: Record<PartStatus, StatusTone> = {
  designing: "design",
  material: "blocked",
  ordered: "blocked",
  drawing: "design",
  drawing_done: "design",
  mentor_approved: "design",
  ready: "ready",
  cnc: "ready",
  laser: "ready",
  lathe: "ready",
  mill: "ready",
  printer: "ready",
  router: "ready",
  manufacturing: "working",
  outsourced: "working",
  welding: "working",
  scotchbrite: "working",
  anodize: "working",
  powder: "working",
  coating: "working",
  assembly: "working",
  done: "done",
};

export const PRIORITY_MAP: Record<PartPriority, string> = { 0: "High", 1: "Normal", 2: "Low" };

/** e.g. fullPartNumber("RA2026", "assembly", 1000) === "RA2026-A-01000" */
export function fullPartNumber(prefix: string, type: PartType, n: number): string {
  return `${prefix}-${type === "assembly" ? "A" : "P"}-${String(n).padStart(5, "0")}`;
}

export type ProjectRow = {
  id: string;
  name: string;
  part_number_prefix: string;
  created_at: string;
};

export type Project = {
  id: string;
  name: string;
  partNumberPrefix: string;
  createdAt: string;
};

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    partNumberPrefix: row.part_number_prefix,
    createdAt: row.created_at,
  };
}

export type PartRow = {
  id: string;
  project_id: string;
  parent_part_id: string | null;
  part_number: number;
  type: PartType;
  name: string;
  status: PartStatus;
  priority: PartPriority;
  notes: string | null;
  source_material: string | null;
  have_material: boolean;
  quantity: string | null;
  cut_length: string | null;
  drawing_created: boolean;
  created_at: string;
  onshape_document_id: string | null;
  onshape_element_id: string | null;
  onshape_part_id: string | null;
  onshape_url: string | null;
};

export type Part = {
  id: string;
  projectId: string;
  parentPartId: string | null;
  partNumber: number;
  type: PartType;
  name: string;
  status: PartStatus;
  priority: PartPriority;
  notes: string | null;
  sourceMaterial: string | null;
  haveMaterial: boolean;
  quantity: string | null;
  cutLength: string | null;
  drawingCreated: boolean;
  createdAt: string;
  onshapeDocumentId: string | null;
  onshapeElementId: string | null;
  onshapePartId: string | null;
  onshapeUrl: string | null;
};

export function partFromRow(row: PartRow): Part {
  return {
    id: row.id,
    projectId: row.project_id,
    parentPartId: row.parent_part_id,
    partNumber: row.part_number,
    type: row.type,
    name: row.name,
    status: row.status,
    priority: row.priority,
    notes: row.notes,
    sourceMaterial: row.source_material,
    haveMaterial: row.have_material,
    quantity: row.quantity,
    cutLength: row.cut_length,
    drawingCreated: row.drawing_created,
    createdAt: row.created_at,
    onshapeDocumentId: row.onshape_document_id,
    onshapeElementId: row.onshape_element_id,
    onshapePartId: row.onshape_part_id,
    onshapeUrl: row.onshape_url,
  };
}

export type OnshapeConnectionRow = {
  id: string;
  person_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type OnshapeConnection = {
  id: string;
  personId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export function onshapeConnectionFromRow(row: OnshapeConnectionRow): OnshapeConnection {
  return {
    id: row.id,
    personId: row.person_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
