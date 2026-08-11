import Link from "next/link";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { activeMembersForKiosk, listWhosHere } from "@/lib/sessions";
import { KioskBoard } from "@/components/KioskBoard";

export default async function KioskPage() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (!(await verifyKioskToken(token))) {
    return (
      <main>
        <h1>Kiosk</h1>
        <p>This tablet isn&apos;t registered. <Link href="/kiosk/setup">Set it up</Link>.</p>
      </main>
    );
  }
  const [members, here] = await Promise.all([activeMembersForKiosk(), listWhosHere()]);
  return (
    <main>
      <h1>Sign in / out</h1>
      <KioskBoard members={members} here={here} />
    </main>
  );
}
