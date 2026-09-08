import { describe, expect, it } from "vitest";
import { isAllowed, NAV_ITEMS, navDestinations, type NavContext } from "./nav-destinations";

// Same set as e2e/auth-gating.spec.ts's ADMIN_ONLY_HREFS ("admin hub is
// mentor-scoped" describe block) — hrefs a mentor must never see anywhere in
// the UI, sidebar or palette alike.
const ADMIN_ONLY_HREFS = [
  "/admin/people",
  "/admin/teams",
  "/admin/meetings",
  "/admin/periods",
  "/admin/kiosk-devices",
  "/admin/drive-sync",
  "/admin/settings",
];

const ctx = (role: NavContext["role"], kioskRegistered = false): NavContext => ({
  role,
  kioskRegistered,
});

describe("navDestinations", () => {
  it("guest with no kiosk cookie sees only the public items", () => {
    const hrefs = navDestinations(ctx("guest")).map((d) => d.href);
    expect(hrefs).toEqual(["/", "/leaderboard"]);
  });

  it("guest with a registered kiosk also sees Kiosk", () => {
    const hrefs = navDestinations(ctx("guest", true)).map((d) => d.href);
    expect(hrefs).toEqual(["/", "/leaderboard", "/kiosk"]);
  });

  it("student sees the student-facing set, no Kiosk/People/Admin", () => {
    const hrefs = navDestinations(ctx("student")).map((d) => d.href);
    expect(hrefs).toEqual([
      "/",
      "/leaderboard",
      "/shop",
      "/batteries",
      "/tools",
      "/teams",
      "/events",
    ]);
  });

  it("mentor sees the public set plus Kiosk/People/Calendar/Admin, excluding admin-only hrefs", () => {
    const hrefs = navDestinations(ctx("mentor")).map((d) => d.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/",
        "/leaderboard",
        "/kiosk",
        "/people",
        "/calendar",
        "/admin",
      ]),
    );
    for (const adminHref of ADMIN_ONLY_HREFS) {
      expect(hrefs).not.toContain(adminHref);
    }
  });

  it("admin sees admin-only items", () => {
    const hrefs = navDestinations(ctx("admin")).map((d) => d.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/admin/settings", "/admin/people"]));
  });

  it("has no duplicate hrefs", () => {
    const hrefs = NAV_ITEMS.map((d) => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("isAllowed", () => {
  const kioskItem = NAV_ITEMS.find((d) => d.gate === "kiosk")!;

  it("denies the kiosk gate to a guest without the kiosk cookie", () => {
    expect(isAllowed(kioskItem, ctx("guest"))).toBe(false);
  });

  it("allows the kiosk gate to a guest with the kiosk cookie", () => {
    expect(isAllowed(kioskItem, ctx("guest", true))).toBe(true);
  });

  it("allows the kiosk gate to a mentor regardless of the kiosk cookie", () => {
    expect(isAllowed(kioskItem, ctx("mentor"))).toBe(true);
    expect(isAllowed(kioskItem, ctx("mentor", true))).toBe(true);
  });
});
