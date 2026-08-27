// Manual integration check: ./dev npx tsx scripts/check-first-login.mjs
// Requires FIRST_USERNAME/FIRST_PASSWORD in the environment. Not run in CI.
import { loginToFirst, fetchWithSession } from "../src/lib/first-auth.ts";

const user = process.env.FIRST_USERNAME;
const pass = process.env.FIRST_PASSWORD;
if (!user || !pass) throw new Error("Set FIRST_USERNAME and FIRST_PASSWORD");

const jar = await loginToFirst(user, pass);
const res = await fetchWithSession(
  "https://my.firstinspires.org/Teams/Page/TeamContacts/TeamRoster?TeamProfileID=1790765",
  jar,
);
if (res.kind !== "ok") throw new Error("session did not authenticate");
if (!res.body.includes("teamContactsModel")) throw new Error("roster model missing from page");
console.log("OK: logged in, roster page fetched,", res.body.length, "bytes");
