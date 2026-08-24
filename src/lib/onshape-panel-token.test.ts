import { SignJWT } from "jose";
import { describe, expect, test } from "vitest";
import { createStudentSessionToken } from "./student-session";
import { createPanelToken, verifyPanelToken } from "./onshape-panel-token";

const SECRET = "test-secret";

describe("onshape panel token", () => {
  test("round-trips a person id", async () => {
    const token = await createPanelToken("p1", SECRET);
    const result = await verifyPanelToken(token, SECRET);
    expect(result).toEqual({ personId: "p1" });
  });

  test("rejects a student-session token (wrong kind)", async () => {
    const studentToken = await createStudentSessionToken("p1", SECRET);
    expect(await verifyPanelToken(studentToken, SECRET)).toBeNull();
  });

  test("student verifier rejects a panel token (wrong kind, symmetric)", async () => {
    const panelToken = await createPanelToken("p1", SECRET);
    const { verifyStudentSessionToken } = await import("./student-session");
    expect(await verifyStudentSessionToken(panelToken, SECRET)).toBeNull();
  });

  test("rejects a tampered/garbage token", async () => {
    expect(await verifyPanelToken("not-a-jwt", SECRET)).toBeNull();
    const token = await createPanelToken("p1", SECRET);
    expect(await verifyPanelToken(token + "x", SECRET)).toBeNull();
  });

  test("rejects a token signed with the wrong secret", async () => {
    const token = await createPanelToken("p1", SECRET);
    expect(await verifyPanelToken(token, "other-secret")).toBeNull();
  });

  test("rejects an expired token", async () => {
    const expired = await new SignJWT({ sub: "p1", kind: "onshape-panel" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(0)
      .setExpirationTime(1)
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyPanelToken(expired, SECRET)).toBeNull();
  });

  test("rejects a non-string sub", async () => {
    const badSub = await new SignJWT({ sub: undefined, kind: "onshape-panel" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("90d")
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyPanelToken(badSub, SECRET)).toBeNull();
  });
});
