import { SignJWT, jwtVerify } from "jose";

export const PANEL_TOKEN_KIND = "onshape-panel";
const PANEL_TOKEN_DURATION = "90d";

export async function createPanelToken(
  personId: string,
  secret: string,
): Promise<string> {
  return new SignJWT({ sub: personId, kind: PANEL_TOKEN_KIND })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(PANEL_TOKEN_DURATION)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyPanelToken(
  token: string,
  secret: string,
): Promise<{ personId: string } | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    if (payload.kind !== PANEL_TOKEN_KIND || typeof payload.sub !== "string") {
      return null;
    }
    return { personId: payload.sub };
  } catch {
    return null;
  }
}
