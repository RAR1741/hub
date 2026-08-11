import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listKioskDevices } from "@/lib/kiosk";
import { KioskDeviceManager } from "@/components/KioskDeviceManager";

export default async function AdminKioskDevicesPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");
  const devices = await listKioskDevices();
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin — Kiosk devices</h1>
      <p className="text-sm text-[var(--color-muted-fg)]">
        Create a token, then enter it once on the shop tablet at <code>/kiosk/setup</code>.
      </p>
      <section className="card flex flex-col gap-4">
        <KioskDeviceManager devices={devices} />
      </section>
    </main>
  );
}
