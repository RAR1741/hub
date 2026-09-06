import { SignJWT, jwtVerify } from "jose";

export const PANEL_TOKEN_KIND = "onshape-panel";
// Long-lived bearer stored in the browser's localStorage (the Onshape panel is
// a cross-origin iframe, so it can't use httpOnly cookies). Kept short-ish to
// bound the XSS-exfiltration window; the panel prompts a cheap "Reconnect" on
// expiry, and every request also re-checks the person's is_active/role, so a
// stolen token dies the moment the user is deactivated regardless of this. See
// security audit #251.
const PANEL_TOKEN_DURATION = "30d";
/** The above, in seconds — exported for tests to assert the minted lifetime. */
export const PANEL_TOKEN_DURATION_SECONDS = 30 * 24 * 60 * 60;

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
