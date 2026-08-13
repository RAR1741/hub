import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { KioskSetupForm } from "@/components/KioskBoard";

export default async function KioskSetupPage() {
  // Registering a tablet is a mentor+ action: they log in, enter the device
  // token from Admin → Kiosk devices, then may log out — the kiosk cookie keeps
  // the board running without a session.
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/login");
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="card flex w-full max-w-md flex-col gap-4 shadow-lg">
        <div className="eyebrow">Team Hub · Kiosk</div>
        <h1 className="text-2xl font-bold tracking-tight">Kiosk setup</h1>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Enter the kiosk token from an admin (Admin → Kiosk devices) to register this tablet.
        </p>
        <KioskSetupForm />
      </div>
    </main>
  );
}
