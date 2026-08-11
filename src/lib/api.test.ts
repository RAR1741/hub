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

  test("passes route context through to the handler", async () => {
    const guarded = withRole<{ params: Promise<{ id: string }> }>(
      "admin",
      async (_viewer, _request, context) => {
        const { id } = await context.params;
        return Response.json({ id });
      },
      async () => ({
        person: {
          id: "p1", firstName: "A", lastName: "B", displayName: null,
          role: "admin", gradYear: null, email: null, isActive: true,
          studentIdNumber: null, authUserId: null,
          phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
        },
        role: "admin",
      }),
    );
    const res = await guarded(new Request("http://test/api/admin/teams/t9"), {
      params: Promise.resolve({ id: "t9" }),
    });
    expect(await res.json()).toEqual({ id: "t9" });
  });
});
