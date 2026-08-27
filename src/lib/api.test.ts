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
        studentIdNumber: null,
        phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
        dateOfBirth: null, streetAddress: null, city: null, zip: null,
        homePhone: null, school: null, ethnicity: null, race: null,
        interests: null, lastApplicationAt: null,
        firstPeopleId: null, firstConsentRelease: null, firstScreeningStatus: null,
        firstScreeningText: null, firstTrainingStatus: null, firstSyncedAt: null,
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
          studentIdNumber: null,
          phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
          dateOfBirth: null, streetAddress: null, city: null, zip: null,
          homePhone: null, school: null, ethnicity: null, race: null,
          interests: null, lastApplicationAt: null,
          firstPeopleId: null, firstConsentRelease: null, firstScreeningStatus: null,
          firstScreeningText: null, firstTrainingStatus: null, firstSyncedAt: null,
        },
        role: "admin",
      }),
    );
    const res = await guarded(new Request("http://test/api/admin/teams/t9"), {
      params: Promise.resolve({ id: "t9" }),
    });
    expect(await res.json()).toEqual({ id: "t9" });
  });

  test("masquerade session blocks POST but allows GET", async () => {
    const masqueradeViewer = {
      person: {
        id: "target1", firstName: "T", lastName: "S", displayName: null,
        role: "student", gradYear: 2027, email: null, isActive: true,
        studentIdNumber: "9999",
        phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
        dateOfBirth: null, streetAddress: null, city: null, zip: null,
        homePhone: null, school: null, ethnicity: null, race: null,
        interests: null, lastApplicationAt: null,
        firstPeopleId: null, firstConsentRelease: null, firstScreeningStatus: null,
        firstScreeningText: null, firstTrainingStatus: null, firstSyncedAt: null,
      },
      role: "student",
      masquerade: {
        adminPersonId: "admin1",
        targetPersonId: "target1",
        sessionId: "sess1",
      },
    } as const;

    const handler = withRole(
      "student",
      async () => Response.json({ ok: true }),
      async () => masqueradeViewer,
    );

    // GET should pass through
    const getRes = await handler(new Request("http://test/api/student/profile", { method: "GET" }));
    expect(getRes.status).toBe(200);

    // POST should be blocked with 403 masquerade_read_only
    const postRes = await handler(new Request("http://test/api/student/profile", { method: "POST" }));
    expect(postRes.status).toBe(403);
    expect(await postRes.json()).toEqual({ error: "masquerade_read_only" });

    // HEAD should pass through
    const headRes = await handler(new Request("http://test/api/student/data", { method: "HEAD" }));
    expect(headRes.status).toBe(200);

    // PATCH should be blocked
    const patchRes = await handler(new Request("http://test/api/student/profile", { method: "PATCH" }));
    expect(patchRes.status).toBe(403);
    expect(await patchRes.json()).toEqual({ error: "masquerade_read_only" });
  });
});
