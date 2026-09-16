// src/lib/notification-types.ts
import type { Role } from "./types";

export const NOTIFICATION_TYPES = [
  "admin_alerts",
  "clocked_in_late",
  "meeting_reminder",
  "consent_missing",
  "meeting_changed",
  "system_health",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationMeta = {
  type: NotificationType;
  label: string;
  description: string;
  roles: Role[]; // which roles may enable this type
};

// Role = "admin" | "mentor" | "student" | "guest". Members = everyone signed in
// except guests. (There is no app-level "captain" Role — that's a person_role
// enum value the app maps to "student"; do not reference it here.)
const MEMBER: Role[] = ["student", "mentor", "admin"];
const MENTORS: Role[] = ["mentor", "admin"];
const ADMINS: Role[] = ["admin"];

export const NOTIFICATION_META: Record<NotificationType, NotificationMeta> = {
  admin_alerts: {
    type: "admin_alerts",
    label: "Admin alerts",
    description: "Sync failures and other #hub-admin-alerts posts.",
    roles: ADMINS,
  },
  system_health: {
    type: "system_health",
    label: "System health",
    description: "A hub subsystem (e.g. Slack delivery) starts failing or recovers — sent over push so it still arrives when Slack is down.",
    roles: ADMINS,
  },
  clocked_in_late: {
    type: "clocked_in_late",
    label: "Still clocked in",
    description: "A nightly nudge if you forgot to clock out.",
    roles: MEMBER,
  },
  meeting_reminder: {
    type: "meeting_reminder",
    label: "Meeting reminders",
    description: "A reminder before each meeting starts — pick how far ahead below.",
    roles: MEMBER,
  },
  consent_missing: {
    type: "consent_missing",
    label: "Outstanding FIRST requirements",
    description: "A weekly reminder if you have unfinished consent/YPP items.",
    roles: MENTORS,
  },
  meeting_changed: {
    type: "meeting_changed",
    label: "Meeting time changes",
    description: "When a meeting's start time moves.",
    roles: MEMBER,
  },
};

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(v);
}

export function typesForRole(role: Role): NotificationMeta[] {
  return NOTIFICATION_TYPES.map((t) => NOTIFICATION_META[t]).filter((m) => m.roles.includes(role));
}
