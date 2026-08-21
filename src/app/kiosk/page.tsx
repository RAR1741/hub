import Link from "next/link";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { activeMembersForKiosk, listWhosHere } from "@/lib/sessions";
import { KioskBoard } from "@/components/KioskBoard";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";

export default async function KioskPage() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  const [viewer, tokenOk] = await Promise.all([
    getViewer(),
    verifyKioskToken(token),
  ]);
  const authorized = hasRole(viewer.role, "mentor") || tokenOk;
  if (!authorized) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="hazard w-full max-w-md rounded-t-xl" />
        <div className="card w-full max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Kiosk</h1>
          <p className="mt-3 text-lg text-[var(--color-muted-fg)]">
            This tablet isn&apos;t registered.{" "}
            <Link href="/kiosk/setup" className="font-semibold text-[var(--color-brand)]">
              Set it up
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }
  const [{ students, mentors }, here] = await Promise.all([
    activeMembersForKiosk(),
    listWhosHere(),
  ]);
  return (
    <main className="flex min-h-full flex-col p-4 sm:p-6 lg:p-8">
      <KioskBoard students={students} mentors={mentors} here={here} />
    </main>
  );
}
