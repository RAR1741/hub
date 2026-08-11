import { describe, expect, test } from "vitest";
import { withRole } from "./api";
import type { Viewer } from "./viewer";

function handlerFor(viewer: Viewer) {
  return withRole(
    "admin",
    async () => Response.json({ ok: true }),
    async () => viewer,
  );
}

describe("withRole", () => {
  test("admin passes through", async () => {
    const res = await handlerFor({
      person: {
        id: "p1", firstName: "A", lastName: "B", displayName: null,
        role: "admin", gradYear: null, email: null, isActive: true,
        studentIdNumber: null, authUserId: null,
        phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
      },
      role: "admin",
    })(new Request("http://test/api/admin/ping"));
    expect(res.status).toBe(200);
  });

  test("guest gets 403", async () => {
    const res = await handlerFor({ person: null, role: "guest" })(
      new Request("http://test/api/admin/ping"),
    );
    expect(res.status).toBe(403);
  });
});
