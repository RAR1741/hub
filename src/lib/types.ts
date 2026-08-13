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
  auth_user_id: string | null;
  phone?: string | null;
  shirt_size?: string | null;
  dietary_restrictions?: string | null;
  bio?: string | null;
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
  authUserId: string | null;
  phone: string | null;
  shirtSize: string | null;
  dietaryRestrictions: string | null;
  bio: string | null;
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
    authUserId: row.auth_user_id,
    phone: row.phone ?? null,
    shirtSize: row.shirt_size ?? null,
    dietaryRestrictions: row.dietary_restrictions ?? null,
    bio: row.bio ?? null,
  };
}

export type JoinMode = "admin_only" | "open" | "requires_approval";

export type TeamRow = {
  id: string;
  name: string;
  parent_team_id: string | null;
  description: string | null;
  join_mode: JoinMode;
};

export type Team = {
  id: string;
  name: string;
  parentTeamId: string | null;
  description: string | null;
  joinMode: JoinMode;
};

export function teamFromRow(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    parentTeamId: row.parent_team_id,
    description: row.description,
    joinMode: row.join_mode,
  };
}

export type ApplicationStatus = "pending" | "approved" | "denied";

export type SessionSource = "kiosk" | "manual" | "admin";

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
  };
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
