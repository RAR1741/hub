import { KIOSK_COOKIE } from "./kiosk";

/** Read the kiosk device token from the request's Cookie header. PURE. */
export function kioskTokenFromRequest(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === KIOSK_COOKIE) return rest.join("=");
  }
  return undefined;
}
