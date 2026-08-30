import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listKioskDevices } from "@/lib/kiosk";
import { KioskDeviceManager } from "@/components/KioskDeviceManager";

export const metadata: Metadata = { title: "Kiosk Devices" };

export default async function AdminKioskDevicesPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");
  const devices = await listKioskDevices();
  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Kiosk devices</h1>
          <div className="sub">{devices.length} device{devices.length === 1 ? "" : "s"} registered</div>
        </div>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Create a token, then enter it once on the shop tablet at <code>/kiosk/setup</code>.
      </p>
      <section className="card flex flex-col gap-4">
        <KioskDeviceManager devices={devices} />
      </section>
    </main>
  );
}
