// Manual live check: paste a fresh Cookie header into FIRST_COOKIE, then:
//   ./dev bash -lc 'FIRST_COOKIE="<paste>" npx tsx scripts/check-first-login.mjs'
// Not run in CI (CI can't reach FIRST).
import { fetchWithSession, normalizeCookieHeader } from "../src/lib/first-auth.ts";

const cookie = normalizeCookieHeader(process.env.FIRST_COOKIE ?? "");
if (!cookie) throw new Error("Set FIRST_COOKIE to a pasted my.firstinspires.org Cookie header");

const res = await fetchWithSession(
  "https://my.firstinspires.org/Teams/Page/TeamContacts/TeamRoster?TeamProfileID=1790765",
  cookie,
);
if (res.kind !== "ok") throw new Error("session did not authenticate (cookie expired?)");
if (!res.body.includes("teamContactsModel")) throw new Error("roster model missing from page");
console.log("OK: cookie authenticated, roster page fetched,", res.body.length, "bytes");
