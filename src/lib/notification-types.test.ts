// src/lib/notification-types.test.ts
import { describe, expect, test } from "vitest";
import {
  NOTIFICATION_TYPES,
  isNotificationType,
  typesForRole,
} from "./notification-types";

describe("notification-types", () => {
  test("registry lists all six types", () => {
    expect([...NOTIFICATION_TYPES].sort()).toEqual(
      ["admin_alerts", "clocked_in_late", "consent_missing", "meeting_changed", "meeting_reminder", "system_health"],
    );
  });

  test("isNotificationType guards unknown strings", () => {
    expect(isNotificationType("admin_alerts")).toBe(true);
    expect(isNotificationType("nope")).toBe(false);
    expect(isNotificationType(42)).toBe(false);
  });

  test("students see meeting types but not admin_alerts or consent_missing", () => {
    const forStudent = typesForRole("student").map((m) => m.type).sort();
    expect(forStudent).toEqual(["clocked_in_late", "meeting_changed", "meeting_reminder"]);
    expect(forStudent).not.toContain("system_health");
  });

  test("guests get nothing", () => {
    expect(typesForRole("guest")).toHaveLength(0);
  });

  test("admins see every type", () => {
    expect(typesForRole("admin")).toHaveLength(6);
  });

  test("mentors see consent_missing but not admin_alerts", () => {
    const forMentor = typesForRole("mentor").map((m) => m.type);
    expect(forMentor).toContain("consent_missing");
    expect(forMentor).not.toContain("admin_alerts");
    expect(forMentor).not.toContain("system_health");
  });
});
